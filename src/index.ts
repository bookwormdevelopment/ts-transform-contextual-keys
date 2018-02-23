export * from './transformer';

export declare function keys<T>(): Array<keyof T>;
export declare function keysMap<T>(): { [p in keyof T]: boolean };
export declare function keysMeta<T>(): Array<{ name: string; optional: boolean; }>;
