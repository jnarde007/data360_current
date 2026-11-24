/**
 * Wallet Reconciliation Diagnostic Engine
 * Analyzes wallet variance and infers likely causes with confidence levels.
 */

export type DiagnosticConfidence = 'likely' | 'possible' | 'needs_review';

export interface DiagnosticResult {
  likelyCause: string;
  confidence: DiagnosticConfidence;
  suggestedFix: string;
  explanation: string;
  unmatchedEntries: UnmatchedEntry[];
  balanceTimeline: TimelineEntry[];
}

export interface UnmatchedEntry {
  id: string;
  date: string;
  type: 'credit' | 'debit';
  amount: number;
  description: string;
  reference: string;
  flag: string; // e.g. 'duplicate', 'missing_counterpart', 'suspicious_timing'
}

export interface TimelineEntry {
  date: string;
  event: string;
  amount: number;
  runningBalance: number;
  type: 'credit' | 'debit';
  reference: string;
  flagged?: boolean;
}

interface WalletTx {
  id: string;
  type: string;
  amount: number;
  description: string;
  reference: string;
  created_at: string;
  admin_id?: string | null;
  balance_before?: number | null;
  balance_after?: number | null;
}

export function diagnoseWalletVariance(
  currentBalance: number,
  computedBalance: number,
  transactions: WalletTx[]
): DiagnosticResult {
  const variance = currentBalance - computedBalance;
  const absVariance = Math.abs(variance);
  const isPositive = variance > 0; // current > computed = extra credit or missing debit in ledger

  const unmatchedEntries: UnmatchedEntry[] = [];

  // Sort transactions chronologically
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  // Build balance timeline
  let runningBalance = 0;
  const balanceTimeline: TimelineEntry[] = sorted.map((tx) => {
    const amt = Number(tx.amount);
    if (tx.type === 'credit') runningBalance += amt;
    else runningBalance -= amt;
    return {
      date: tx.created_at,
      event: tx.description,
      amount: amt,
      runningBalance,
      type: tx.type as 'credit' | 'debit',
      reference: tx.reference,
    };
  });

  // Check 1: Duplicate references (same reference appearing multiple times for same type)
  const refCounts = new Map<string, { count: number; txs: WalletTx[] }>();
  for (const tx of transactions) {
    const key = `${tx.reference}:${tx.type}`;
    const existing = refCounts.get(key);
    if (existing) {
      existing.count++;
      existing.txs.push(tx);
    } else {
      refCounts.set(key, { count: 1, txs: [tx] });
    }
  }

  const duplicates: WalletTx[] = [];
  for (const [, entry] of refCounts) {
    if (entry.count > 1) {
      // All but the first are duplicates
      for (let i = 1; i < entry.txs.length; i++) {
        duplicates.push(entry.txs[i]);
        unmatchedEntries.push({
          id: entry.txs[i].id,
          date: entry.txs[i].created_at,
          type: entry.txs[i].type as 'credit' | 'debit',
          amount: Number(entry.txs[i].amount),
          description: entry.txs[i].description,
          reference: entry.txs[i].reference,
          flag: 'duplicate',
        });
      }
    }
  }

  // Calculate total duplicate amount
  const duplicateCreditSum = duplicates
    .filter((d) => d.type === 'credit')
    .reduce((s, d) => s + Number(d.amount), 0);
  const duplicateDebitSum = duplicates
    .filter((d) => d.type === 'debit')
    .reduce((s, d) => s + Number(d.amount), 0);

  // Check 2: balance_after discontinuities (if available)
  const txsWithBalances = sorted.filter(
    (t) => t.balance_before != null && t.balance_after != null
  );
  const discontinuities: WalletTx[] = [];
  for (let i = 1; i < txsWithBalances.length; i++) {
    const prev = txsWithBalances[i - 1];
    const curr = txsWithBalances[i];
    if (
      prev.balance_after != null &&
      curr.balance_before != null &&
      Math.abs(prev.balance_after - curr.balance_before) > 0.01
    ) {
      discontinuities.push(curr);
      unmatchedEntries.push({
        id: curr.id,
        date: curr.created_at,
        type: curr.type as 'credit' | 'debit',
        amount: Number(curr.amount),
        description: curr.description,
        reference: curr.reference,
        flag: 'balance_gap',
      });
    }
  }

  // Check 3: Admin credits without matching description context
  const suspiciousAdmin = transactions.filter(
    (t) =>
      t.admin_id &&
      t.type === 'credit' &&
      (!t.description || t.description.trim().length < 5)
  );
  for (const tx of suspiciousAdmin) {
    if (!unmatchedEntries.find((u) => u.id === tx.id)) {
      unmatchedEntries.push({
        id: tx.id,
        date: tx.created_at,
        type: 'credit',
        amount: Number(tx.amount),
        description: tx.description,
        reference: tx.reference,
        flag: 'undocumented_admin',
      });
    }
  }

  // Check 4: Look for exact amount match with variance
  const exactMatches = transactions.filter(
    (t) => Math.abs(Number(t.amount) - absVariance) < 0.01
  );

  // Mark flagged entries in timeline
  const flaggedIds = new Set(unmatchedEntries.map((u) => u.id));
  for (const entry of balanceTimeline) {
    const matchTx = sorted.find((t) => t.reference === entry.reference && t.created_at === entry.date);
    if (matchTx && flaggedIds.has(matchTx.id)) {
      entry.flagged = true;
    }
  }

  // === DIAGNOSIS ===

  // Case 1: Duplicate credits explain the variance
  if (isPositive && duplicates.length > 0 && Math.abs(duplicateCreditSum - absVariance) < 0.01) {
    return {
      likelyCause: 'Duplicate wallet credit(s) in the transaction ledger',
      confidence: 'likely',
      suggestedFix:
        'Remove or reverse the duplicate credit entry. The wallet balance appears correct but the ledger has an extra credit record that was already applied.',
      explanation: `Found ${duplicates.length} duplicate credit transaction(s) totalling the exact variance amount. The same reference was credited more than once, likely due to a webhook/verification race condition.`,
      unmatchedEntries,
      balanceTimeline,
    };
  }

  // Case 2: Balance gap / discontinuity found
  if (discontinuities.length > 0) {
    return {
      likelyCause: 'Balance discontinuity between consecutive transactions',
      confidence: 'possible',
      suggestedFix:
        'A wallet mutation occurred outside the transaction ledger (possibly a direct database update or migration). Create a corrective adjustment entry to reconcile the gap.',
      explanation: `Found ${discontinuities.length} point(s) where the ending balance of one transaction doesn't match the starting balance of the next. This indicates a wallet mutation that wasn't recorded in the ledger.`,
      unmatchedEntries,
      balanceTimeline,
    };
  }

  // Case 3: Exact amount match with a single transaction
  if (exactMatches.length === 1) {
    const match = exactMatches[0];
    const isAdmin = !!match.admin_id;
    if (isPositive && match.type === 'credit') {
      return {
        likelyCause: isAdmin
          ? 'Manual admin credit not properly reflected in ledger computation'
          : `Extra credit of the exact variance amount (ref: ${match.reference})`,
        confidence: 'possible',
        suggestedFix: isAdmin
          ? 'Verify the admin credit was intentional. If so, the balance is correct and the computed total needs adjustment. Otherwise, reverse the credit.'
          : 'Inspect this transaction to determine if it was applied to the wallet balance but recorded incorrectly in the ledger.',
        explanation: `A single ${match.type} transaction of the exact variance amount was found: "${match.description}" (${match.reference}). This ${isAdmin ? 'admin-initiated' : ''} entry is the most probable source of the discrepancy.`,
        unmatchedEntries,
        balanceTimeline,
      };
    }
    if (!isPositive && match.type === 'debit') {
      return {
        likelyCause: 'Debit recorded in ledger but not deducted from wallet balance',
        confidence: 'possible',
        suggestedFix:
          'The ledger shows a debit that may not have been applied to the actual wallet balance. Verify if the deduction failed and create a corrective entry.',
        explanation: `A debit of the exact variance amount was found: "${match.description}" (${match.reference}). The wallet balance is lower than expected, suggesting this debit was recorded but the balance wasn't updated.`,
        unmatchedEntries,
        balanceTimeline,
      };
    }
  }

  // Case 4: Positive variance - wallet has more than ledger says
  if (isPositive) {
    if (suspiciousAdmin.length > 0) {
      return {
        likelyCause: 'Undocumented admin credit(s) may have inflated wallet balance',
        confidence: 'possible',
        suggestedFix:
          'Review the admin credits listed below. If they are legitimate, add proper descriptions. If not, reverse them with a corrective debit.',
        explanation: `The wallet balance exceeds the computed ledger total by the variance amount. ${suspiciousAdmin.length} admin credit(s) with missing or minimal descriptions were found, which may explain the extra balance.`,
        unmatchedEntries,
        balanceTimeline,
      };
    }

    return {
      likelyCause:
        'Wallet balance contains a credit not recorded in the transaction ledger',
      confidence: 'needs_review',
      suggestedFix:
        'Inspect the most recent wallet mutations. Look for a manual database adjustment, migration artifact, or payment callback that credited the wallet without creating a transaction record. Create a corrective adjustment entry to align the ledger.',
      explanation: `The current wallet balance is higher than what the transaction ledger computes. This typically indicates a wallet credit was applied (e.g., via direct DB update, migration, or race condition) without a corresponding ledger entry.`,
      unmatchedEntries,
      balanceTimeline,
    };
  }

  // Case 5: Negative variance - wallet has less than ledger says
  if (duplicates.length > 0 && Math.abs(duplicateDebitSum - absVariance) < 0.01) {
    return {
      likelyCause: 'Duplicate wallet debit(s) in the transaction ledger',
      confidence: 'likely',
      suggestedFix:
        'The ledger has duplicate debit records. Remove the extra debit entries or credit back the over-deducted amount.',
      explanation: `Found ${duplicates.length} duplicate debit transaction(s) totalling the exact variance. The same deduction reference appears more than once.`,
      unmatchedEntries,
      balanceTimeline,
    };
  }

  return {
    likelyCause:
      'Wallet balance is lower than the computed ledger total — possible unrecorded debit or failed credit',
    confidence: 'needs_review',
    suggestedFix:
      'Review the transaction history for missing credits (e.g., a topup that was recorded in the ledger but never actually applied to the balance) or extra debits applied outside the ledger. A corrective credit may be needed.',
    explanation: `The wallet balance is lower than what all ledger entries compute to. This could be caused by a failed credit application, a direct balance deduction not recorded in the ledger, or a timing issue during concurrent transactions.`,
    unmatchedEntries,
    balanceTimeline,
  };
}
