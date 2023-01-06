# JSPISA

JSProg Instruction Set Architecture (JSPISA) is an intermediate JSON representation which defines a minimal instruction set (derived roughly from the intersection of the Intel x86 instruction set with the WASM instruction set). It is intended to be simple enough to be able to applied to many source instruction set architectures.

Unlike real ISAs, the JSPISA is written in JSON and is intended to be consumed by a post-processor/assembler (and not run directly). The JSPISA is also extensible, as custom operand types and instructions can be emitted in JSPISA format, then assembled via callback functions for the source ISA.

Although it is possible to implement as many custom operand types and mnemonics as you desire, the processing functions used during analysis for a specific source ISA should emit instructions using these mnemonics and operand formats as much as possible. This is to help reduce the amount of custom code implemented for a specific source ISA, reducing development burden.

## Chunk

A complete chunk of code corresponds to a `Chunk` structure (from `jsprog/loader/structs.js`). A `Chunk` structure requires you to provide a name for the chunk, an array of instructions making up the chunk, the ranges of addresses comprising the chunk, and an array of branch targets within the chunk.

- By convention, `name` is defined as `FUN_<virtualaddr>` for a given chunk. However, you could name each chunk however you desire.
- `instructions` is an array of `Instruction` structures, which are defined below.
- `chunkRanges` is intended to be used during chunk processing to ensure the same ranges are not processed multiple times.
- `branchTargets` is a list of instruction IDs (indices in the `instructions` array) which are destinations for branches. Note this is normally populated after chunk processing is initially completed as you need to identify all branch targets both in the current chunk, and from external sources. Getting this list to be accurate is crucial as it determines the chunks which are imported in WASM assembly.

## Instruction

A single instruction requires the following fields:

- `prefixSet` is an array of integers representing any prefix bytes applied to the instruction. This is mostly used by Intel ISAs; if your source ISA does not make use of prefixes, you should leave this as an empty list.
- `opcode` is an integer representing the opcode of the instruction. This is intended to be used for debugging and is not used during assembly.
- `virtualAddress` is the virtual address of the instruction. This is intended to be used to help compute absolute JMP/CALL destination addresses based on offsets.
- `next` is the virtual address of the next instruction. This is intended to be used to help compute absolute JMP/CALL destination addresses based on offsets.
- `mnemonic` is the mnemonic of the instruction. This is used during assembly to determine how the instruction translates to WASM bytecode. As such, it is important to select the `mnemonic` for an input opcode carefully.
    Although it's recommended to use a `mnemonic` from the list below, if you can't find a matching mnemonic, you can use a custom name and implement the translation yourself in the `buildInstructionCallback` function for your source ISA.
- `operandSet` is an array of operand structures, as defined below. These define the operands used for the current instruction.

## Operand Formats

All operands require `type`, `val`, and `size` fields. Certain operands may support additional fields depending on how they are used.

- `type` is a string representing the operand type (see the below list).
    Although it's recommended to use a `type` from the list below, if you can't find a matching type, you can use a custom name and implement the translation yourself in the operand callbacks for your source ISA.
- `val` is an integer representing the value of the operand. This value may represent different things depending on the operand type, but should always be an integer.
- `size` is an integer representing the operand size, in bits. It's recommended to try and size operands as either `32` or `64` to align with WASM; however, translations should still be able to support `8` and `16` as well.

### imm

The `imm` operand format defines a constant integer value (immediate).

Supported fields:
- `val`: the constant value of the immediate.
- `indirect`: if set to `true`, the immediate will be treated as a memory location.

### reg

The `reg` operand format defines a register.

Supported fields:
- `val`: an index into the `registers` array for the architecture.
- `indirect`: if set to `true`, the value of the register will be treated as a memory location.
- `displace`: if present and set to an integer value, represents an offset from the value of the register.
    although it's technically illegal to have a `displace` field on a non-`indirect` register, the translation layer will still accept a non-indirect displaced register.

### seg

The `seg` operand format defines a segment.

Supported fields:
- `val`: an index into the `segments` array for the architecture.
- `indirect`: if set to `true`, the value of the segment will be treated as a memory location.
- `displace`: if present and set to an integer value, represents an offset from the value of the register. Unlike `reg`, `seg` does not support a non-indirect displacement.

### Custom Formats

Custom formats can be defined by using the `SetOperandCallback` on the `Assembler` object prior to assembly. For example, in x86:

`assembler.SetOperandCallbacks(x86.operandToStackCallback, x86.stackToOperandCallback);`

As an example of why this might be required, the `x86` architecture supports the complex Signed Index Byte (SIB) addressing mode, which specifies two registers, a scale, and an offset, in a single operand:

[reg1 + reg2*scale + offset]

As this is not a standard across other source ISAs, SIB was implemented with a `type` of `sib` in the x86 custom processing callbacks.

## Instruction Formats

### EXTERN

The EXTERN instruction is used to indicate a CALL to a function contained in an external DLL. EXTERN requires a single operand, with a `type` of `extern`. This operand type is illegal to use for any instruction other than EXTERN.

The `val` property of the single operand should be set to `<DLL>::<Function>` (for example, `KERNEL32.dll::GetSystemTimeAsFileTime`).

The assembler will make sure to import each function defined in an EXTERN instruction for the chunk.

EXTERN is assembled into a single `call` operand for the function index.

### CALL, JMP

The CALL and JMP instructions are used to indicate a branch. In JSPISA, these are treated identically.

These instructions will only ever reference an instruction within a chunk in the current program (any CALLs or JMPs in the source program which target an imported DLL should be converted to EXTERNs during analysis).

The source ISA may choose to implement pre-processors or post-processors to handle these differently (for example, x86 implements a pre-processor for CALL which pushes `instruction.next` onto the stack, to simulate a return address).

These instructions require three operands in total:

- The first operand should be an `imm` with `val` set to 1. This value is currently unused but is reserved for future use.
- The second operand should be an `imm` with `val` set to the target chunk's ID. If the destination address exists within the current chunk, `val` should be set to `-1`.
- The third operand should be an `imm` with `val` set to the target instruction's ID.

CALL and JMP are assembled into the following steps:

- Sets the `target` register to the target instruction ID
- If the target chunk ID is -1, branches to the target instruction ID without loading a new chunk
- If the target chunk ID is not -1, assemble a `call` operand for the target chunk (which should have been imported)

### RET

The RET instruction is used to return to the calling function.

Some architectures may implement special pre- or post-processing for this instruction (for example, x86 pops the return value from the stack and discards it before returning).

This instruction does not take any operands.

RET is assembled into a single `return` operand.

### INT

The INT instruction is used to trigger an interrupt.

The instruction requires a single operand:

- The first operand should be an `imm` with `val` set to the interrupt number.

The INT instruction passes the interrupt number to the runtime in the `t1` register. Note that interrupt implementations are runtime-specific, so if your program relies on the `INT` instruction, you may need to implement support for your desired interrupt number in the runtime.

INT is assembled into the following steps:

- Sets the `t1` temporary register to the interrupt number
- Assembles a `call` to the `system::interrupt` runtime function

### Conditional JMP

The conditional JMP instructions are used to branch when conditions are met.

The conditions for each conditional JMP are not defined by the assembler base and must be specified by the source ISA using the `assembler.SetFlagTestCallback` function.

The `flagTestCallback` function is responsible for testing whichever ISA-specific flag registers are in use. If the branch should occur, 0x00 is pushed to the WASM stack by this function. Else, 0x01 is pushed to the WASM stack.

The following conditional jump instructions are recognized by default by the assembler base (however, even for these recognized instructions, you still must specify the flag test function):

- JE: Branch if Equal
- JNE: Branch if Not Equal
- JA: Branch if Unsigned Greater Than
- JG: Branch if Signed Greater Than

All conditional jumps are assembled into the following steps:

- Create a block
- Invoke the flag testing callback (expected to place 1 i32 onto the WASM stack)
- Break from created block if set (skipping below JMP)
- Build an unconditional JMP with the same target
- Close the block

### MOV

The MOV instruction is used to move data from one operand to another.

The instruction requires two operands:

- The first operand may be any type, except for a non-`indirect` `imm`. Behaviour is undefined for a non-`indirect` `imm`.
- The second operand may be any type.

MOV is implemented into the following steps:

- Push the second operand onto the WASM stack
- Pop off the WASM stack into the first operand

### LEA

The LEA instruction is used to load the address represented by one operand into another.

This instruction requires two operands:

- The first operand may be any type, except for a non-`indirect` `imm`. Behaviour is undefined for a non-`indirect` `imm`.
- The second operand may be any type, but is expected to be `indirect`. Assembly will fail for a non-`indirect` operand.

LEA is implemented into the following steps:

- Remove the `indirect` flag from the second operand
- Push the second operand onto the WASM stack
- Pop off the WASM stack into the first operand

### PUSH

The PUSH instruction is used to push a value onto the stack. Note that the stack used by PUSH and POP instructions is located in the WASM memory and is NOT the same as the WASM stack.

This instruction requires one operand, which may be of any type.

PUSH is implemented into the following steps:

- Push the first operand onto the WASM stack
- Pop off the WASM stack into the location pointed to by the stack pointer register
- Subtract the size of the first operand from the stack pointer register

### POP

The POP instruction is used the pop a value off of the stack. Note that the stack used by PUSH and POP instructions is located in the WASM memory and is NOT the same as the WASM stack.

This instruction requires one operand, which may be of any type, except for a non-`indirect` `imm`. Behaviour is undefined for a non-`indirect` `imm`.

POP is implemented into the following steps:

- Add the size of the first operand to the stack pointer register
- Push the value pointed to by the stack pointer register onto the WASM stack
- Pop off the WASM stack into the first operand

### ADD

The ADD instruction is used to add two operands together, storing the result in a third operand.

The instruction requires three operands:

- The first operand may be any type, except for a non-`indirect` `imm`, and is the destination operand. Behaviour is undefined for a non-`indirect` `imm`.
- The second operand may be any type, and is the first source operand
- The third operand may be any type, and is the second source operand

ADD is implemented into the following steps:

- Push the second operand onto the WASM stack
- Push the third operand onto the WASM stack
- Assemble an appropriate `add` instruction (i.e. `i32.add` or `i64.add`)
- Pop the result off the WASM stack into the first operand

### SUB

The SUB instruction is used to subtract one operand from another, storing the result in a third operand.

The instruction requires three operands:

- The first operand may be any type, except for a non-`indirect` `imm`, and is the destination operand. Behaviour is undefined for a non-`indirect` `imm`.
- The second operand may be any type, and is the first source operand
- The third operand may be any type, and is the second source operand

SUB is implemented into the following steps:

- Push the second operand onto the WASM stack
- Push the third operand onto the WASM stack
- Assemble an appropriate `sub` instruction (i.e. `i32.sub` or `i64.sub`)
- Pop the result off the WASM stack into the first operand

### MUL

The MUL instruction is used to subtract one operand from another, storing the result in a third operand.

The instruction requires three operands:

- The first operand may be any type, except for a non-`indirect` `imm`, and is the destination operand. Behaviour is undefined for a non-`indirect` `imm`.
- The second operand may be any type, and is the first source operand
- The third operand may be any type, and is the second source operand

MUL is implemented into the following steps:

- Push the second operand onto the WASM stack
- Push the third operand onto the WASM stack
- Assemble an appropriate `mul` instruction (i.e. `i32.mul` or `i64.mul`)
- Pop the result off the WASM stack into the first operand

### SHL

The SHL instruction is used to shift one operand by the value of another, storing the result in a third operand.

The instruction requires three operands:

- The first operand may be any type, except for a non-`indirect` `imm`, and is the destination operand. Behaviour is undefined for a non-`indirect` `imm`.
- The second operand may be any type, and is the first source operand
- The third operand may be any type, and is the second source operand

SHL is implemented into the following steps:

- Push the second operand onto the WASM stack
- Push the third operand onto the WASM stack
- Assemble an appropriate `shl` instruction (i.e. `i32.shl` or `i64.shl`)
- Pop the result off the WASM stack into the first operand

### AND

The AND instruction is used to take the logical AND of two operands, storing the result in a third operand.

The instruction requires three operands:

- The first operand may be any type, except for a non-`indirect` `imm`, and is the destination operand. Behaviour is undefined for a non-`indirect` `imm`.
- The second operand may be any type, and is the first source operand
- The third operand may be any type, and is the second source operand

AND is implemented into the following steps:

- Push the second operand onto the WASM stack
- Push the third operand onto the WASM stack
- Assemble an appropriate `and` instruction (i.e. `i32.and` or `i64.and`)
- Pop the result off the WASM stack into the first operand

### OR

The OR instruction is used to take the logical OR of two operands, storing the result in a third operand.

The instruction requires three operands:

- The first operand may be any type, except for a non-`indirect` `imm`, and is the destination operand. Behaviour is undefined for a non-`indirect` `imm`.
- The second operand may be any type, and is the first source operand
- The third operand may be any type, and is the second source operand

OR is implemented into the following steps:

- Push the second operand onto the WASM stack
- Push the third operand onto the WASM stack
- Assemble an appropriate `or` instruction (i.e. `i32.or` or `i64.or`)
- Pop the result off the WASM stack into the first operand

### XOR

The XOR instruction is used to take the logical XOR of two operands, storing the result in a third operand.

The instruction requires three operands:

- The first operand may be any type, except for a non-`indirect` `imm`, and is the destination operand. Behaviour is undefined for a non-`indirect` `imm`.
- The second operand may be any type, and is the first source operand
- The third operand may be any type, and is the second source operand

XOR is implemented into the following steps:

- Push the second operand onto the WASM stack
- Push the third operand onto the WASM stack
- Assemble an appropriate `xor` instruction (i.e. `i32.xor` or `i64.xor`)
- Pop the result off the WASM stack into the first operand

### NOT

The NOT instruction is used to take the logical NOT of an operand, storing the result in a second operand.

The instruction requires two operands:

- The first operand may be any type, except for a non-`indirect` `imm`, and is the destination operand. Behaviour is undefined for a non-`indirect` `imm`.
- The second operand may be any type, and is the source operand

NOT is implemented into the following steps:

- Push the second operand onto the WASM stack
- Push the constant -1 onto the WASM stack with a size matching the second operand
- Assemble an appropriate `xor` instruction
- Pop the result off the WASM stack into the first operand