# JSProg

JSProg is a translation utility which parses and analyzes PE files (Windows executables) and translates them into WASM binaries to be run on the web.

## Concepts

- The input PE image is broken into a set of WASM files called chunks. Each chunk is an approximation of a single ASM function and is bordered by JMP/CALL source and destinations. 

## Parser

The parser (`parse.js`) is responsible for processing the PE file header, producing a set of section tables and data directories, processing imports from external DLLs, and applying relocations for the image's virtual base in WASM memory.

The parser returns the header fields, the section and data tables, the import list, and a virtual base address where the image will be loaded to.

The parser also provides a utility function for assembling all sections in the PE file into a single buffer, which should be loaded directly into `virtualBase` by the runtime.

A typical use of the parser is below:

```
// parse the PE file to apply relocations, identify sections, and map imports
const parseOutput = await parse.tryParsePE(fileBuffer);
if (!parseOutput) {
    console.log("Failed to parse PE file.");
    return false;
}
const { header, tables, imports, virtualBase } = parseOutput;
// create a memory map of the data contained in each section
const mmap = await parse.createMemoryMap(fileBuffer, tables, virtualBase);
```

## Analyzer

The analyzer (`analyze.js`) is responsible for processing the code of the executable (starting from the formal entrypoint), breaking the code into distinct chunks, and producing an intermediate output in JSON format to be processed further into WASM bytecode.

The intermediate representation in JSON format is intended to be architecture-independent. Details on this format are provided in `JSPISA.md`.

In order to run the analyzer, architecture-specific processing functions must be provided to it. A typical use of the analyzer is below:

```
// run analysis against the information gathered from parsing
// this includes passing a chunk processor (which will be architecture-specific)
const codeChunkSet = await analyze.ProcessAllChunks(x86.ProcessChunk, fileBuffer, tables.sectionTables, header, imports.importList);
if (!codeChunkSet) return false;
// fix references up as EXTERNS or properly-offset CALL and JUMP
const fixupResult = await analyze.FixupChunkReferences(x86.FixupInstruction, codeChunkSet, tables.sectionTables, imports.importList, fileBuffer);
if (!fixupResult) return false;
```

## Assembler

The assembler (`assemble.js`) is responsible for processing the intermediate JSON format and compiling it into WASM bytecode. Each chunk should be processed independently by the assembler.

The assembler requires building an `Assembler` object, which defines the registers, segments, and specific processing functions which are unique to the source architecture. This aids processing the platform-specific source code into WASM bytecode.

The following methods are provided to help build the `Assembler`:

- `assembler.SetRegisters` - takes as input an array of objects; each object should have a `name` field for the register name, and a `type` field for the corresponding WASM type (e.g. `i32`, `i64`).
- `assembler.SetSegments` - takes as input an array of objects; each object should have a `name` field for the segment name, and a `type` field for the corresponding WASM type (e.g. `i32`, `i64`).
- `assembler.SetStackPointer` - takes as input the name of the register which is used as the stack pointer.
- `assembler.AddPreProcessor` - adds a callback function which will be run before each time the mnemonic provided is assembled.
- `assembler.AddPostProcessor` - adds a callback function which will be run after each time the mnemonic provided is assembled.
- `assembler.SetBuildInstructionCallback` - adds a callback function which will be run when the assembler tries to assemble an unrecognized mnemonic; allows an architecture to implement arch-specific instructions.
- `assembler.SetOperandCallbacks` - adds a callback function which will be run when operands are being converted to or from the WASM stack, with a type which is not pre-defined in the assembler.
- `assembler.SetFlagTestCallback` - adds a callback function which will be run each time a conditional operation (i.e. conditional jump) is being assembled; allows the architecture to test its architecture-specific flags.

A typical use of the assembler is below:

```
// create an assembler which will assemble WASM binaries for each chunk from the intermediate JSON representation
const assembler = new assemble.Assembler();

// specify the list of registers and segments available to the assembler (architecture-specific)
assembler.SetRegisters(x86.registers);
assembler.SetSegments(x86.segments);
assembler.SetStackPointer("esp"); // name the register which is used as the stack pointer

// add preprocessor and postprocessor functions which are used to resolve architecture-specific details (such as flag registers, etc)
for (const handler of x86.preprocessors) {
    assembler.AddPreProcessor(handler.mnemonic, handler.f);
}
for (const handler of x86.postprocessors) {
    assembler.AddPostProcessor(handler.mnemonic, handler.f);
}

assembler.SetBuildInstructionCallback(x86.buildInstructionCallback);
assembler.SetOperandCallbacks(x86.operandToStackCallback, x86.stackToOperandCallback);
assembler.SetFlagTestCallback(x86.flagTestCallback);

for (const chunk of codeChunkSet) {
	const wasmBytes = await assembler.AssembleChunk(chunk, true);
    // ...process the output WASM bytecode
}
```