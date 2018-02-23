import * as circularJSON from 'circular-json';
import * as ts from 'typescript';

export class Logger {
  private fileName: string;
  private writeToFile: boolean;
  private writeToStorage: boolean;
  private storage: string[] = [];

  private unflushed: number = 0;
  private maxUnflushed: number = 25;

  public constructor(fileName: string, writeToFile: boolean, storage?: string[]) {
    this.fileName = fileName;
    this.writeToFile = writeToFile;
    this.storage = storage && storage.join ? storage : [];
    this.writeToStorage = this.writeToFile || !!(storage && storage.join); // Enforce buffered writes
  }

  public get noop() {
    return !this.writeToFile && !this.writeToStorage;
  }

  public log(...args: any[]) {
    if (this.noop) {
      // Noop case
      return;
    }

    const parts = args.map((p) => {
      if (p) {
        if ((p as string).toLowerCase) {
          return p;
        } else if (Array.isArray(p)) {
          return p.join(' ');
        } else if (p === Object(p)) {
          // Object
          return `\n  keys: [${Object.keys(p)}]\n  value:${this.pad(this.json(p), 2)}`;
        }

        return this.json(p);
      }

      return '';
    });

    if (this.writeToStorage) {
      this.storage.push(`${new Date().toString()}: ${parts.join(' ')}`);
      this.unflushed++;

      // Make sure to flush every now and then
      if (this.unflushed >= this.maxUnflushed) {
        this.flush();
      }
    } else {
      // Dump directly to file
      this.writeFile([`${new Date().toString()}: ${parts.join(' ')}`]);
    }
  }

  public flush() {
    if (this.unflushed) {
      this.unflushed = 0;

      if (this.writeToFile) {
        this.writeFile(this.storage);

        // Reduce the entire store to a single item
        this.storage = [this.storage.join('\n')];
      }
    }
  }

  private writeFile(storage: string[]) {
    ts.sys.writeFile(this.fileName, storage.join('\n'));
  }

  private pad(lines: string, ammount: number) {
    const padding = this.repeat(' ', ammount);
    return lines.split('\n').map((l) => `${padding}${l}`).join('\n');
  }

  private repeat(what: string, ammount: number): string {
    let i = 0;
    const final = [];

    while (i <= ammount) {
      i++;
      final.push('');
    }

    return final.join(what);
  }

  private json(what: any): string {
    return circularJSON.stringify(what);
  }
}
