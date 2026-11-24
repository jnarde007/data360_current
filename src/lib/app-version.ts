declare const __APP_VERSION__: string;
declare const __APP_BUILD_TIME__: string;
declare const __APP_CACHE_ID__: string;

export const APP_VERSION = __APP_VERSION__;
export const APP_BUILD_TIME = __APP_BUILD_TIME__;
export const APP_CACHE_ID = __APP_CACHE_ID__;

export const APP_VERSION_LABEL = APP_VERSION.slice(0, 12);