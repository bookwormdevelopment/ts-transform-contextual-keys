# ts-transformer-contextual-keys
TypeScript custom transformer able to extract interface keys contextually

## You might look for something else?
This project has started as a fork of [ts-transform-keys](https://github.com/kimamula/ts-transformer-keys), triyng to adapt it to work well with fuse-box as a bundler. Usage of global program instance has not allowed a smooth transition so another approach was taken.

If you want a hasle free solution and your needs don't require contextual behaviour, by all means give **[ts-transform-keys](https://github.com/kimamula/ts-transformer-keys)** a look.

## Contextual
*ts-transform-contextual-keys* does it's job contextually on a per file basis:
- each SourceFile children is visited (A)
- each child of each children (A) is vizited (etc.)
- interfaces are tracked
- ImportDeclarations and ExportDeclarations with a set moduleSpecifier will be visited as a new SourceFile
  - each SourceFile children is visited (A)
  - each child of each children (A) is vizited (etc.)
  - interfaces are tracked
  - etc.

This approach allows discovery of dependencies in the same way that an IDE would do, if you use something it should be improted somewhere for it to be in scope; **if** you are relaying on **globals**, **this transformer won't work for you unless you transform the entire project at a time** (there is no way of guessing where globals come from or what they contain. 

## Contributions and issues
If you use this transformer and encounter a bug, feel free to post it here; make sure to offer some context or sample files(s) allowing to reproduce it.

If you have a bit of time on your heands and would like to help, by all means please do so; check out current issues for possible things to start with.
