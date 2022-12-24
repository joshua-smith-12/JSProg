const {
	conditionalJumpOps
} = require('./utils.js');

/*
chunks.1.FUN_0041132F
{
    "_name": "Chunk",
    "name": "FUN_0041132F",
    "instructions": [
        {
            "_name": "Instruction",
            "prefixSet": [],
            "opcode": 233,
            "operandSet": [
                {
                    "type": "imm",
                    "val": 1,
                    "size": 32
                },
                {
                    "type": "imm",
                    "val": 25,
                    "size": 32
                },
                {
                    "type": "imm",
                    "val": 0,
                    "size": 32
                }
            ],
            "address": 1839,
            "next": 1844,
            "mnemonic": "JMP"
        }
    ],
    "ranges": [
        {
            "chunkRangeStart": 1839,
            "chunkRangeEnd": 1844
        }
    ]
}
*/ 

/*
0000000: 0061 736d                                 ; WASM_BINARY_MAGIC
0000004: 0100 0000                                 ; WASM_BINARY_VERSION
; section "Type" (1)
0000008: 01                                        ; section code
0000009: 00                                        ; section size (guess)
000000a: 01                                        ; num types
; func type 0
000000b: 60                                        ; func
000000c: 01                                        ; num params
000000d: 7f                                        ; i32
000000e: 00                                        ; num results
0000009: 05                                        ; FIXUP section size
; section "Import" (2)
000000f: 02                                        ; section code
0000010: 00                                        ; section size (guess)
0000011: 01                                        ; num imports
; import header 0
0000012: 05                                        ; string length
0000013: 6368 756e 6b                             chunk  ; import module name
0000018: 03                                        ; string length
0000019: 696d 70                                  imp  ; import field name
000001c: 00                                        ; import kind
000001d: 00                                        ; import signature index
0000010: 0d                                        ; FIXUP section size
; section "Function" (3)
000001e: 03                                        ; section code
000001f: 00                                        ; section size (guess)
0000020: 01                                        ; num functions
0000021: 00                                        ; function 0 signature index
000001f: 02                                        ; FIXUP section size
; section "Export" (7)
0000022: 07                                        ; section code
0000023: 00                                        ; section size (guess)
0000024: 01                                        ; num exports
0000025: 03                                        ; string length
0000026: 6578 70                                  exp  ; export name
0000029: 00                                        ; export kind
000002a: 01                                        ; export func index
0000023: 07                                        ; FIXUP section size
; section "Code" (10)
000002b: 0a                                        ; section code
000002c: 00                                        ; section size (guess)
000002d: 01                                        ; num functions
; function body 0
000002e: 00                                        ; func body size (guess)
000002f: 00                                        ; local decl count
0000030: 0b                                        ; end
000002e: 02                                        ; FIXUP func body size
000002c: 04                                        ; FIXUP section size
; section "name"
0000031: 00                                        ; section code
0000032: 00                                        ; section size (guess)
0000033: 04                                        ; string length
0000034: 6e61 6d65                                name  ; custom section name
0000038: 01                                        ; name subsection type
0000039: 00                                        ; subsection size (guess)
000003a: 02                                        ; num names
000003b: 00                                        ; elem index
000003c: 08                                        ; string length
000003d: 696d 706f 7274 6564                      imported  ; elem name 0
0000045: 01                                        ; elem index
0000046: 08                                        ; string length
0000047: 6578 706f 7274 6564                      exported  ; elem name 1
0000039: 15                                        ; FIXUP subsection size
000004f: 02                                        ; local name type
0000050: 00                                        ; subsection size (guess)
0000051: 02                                        ; num functions
0000052: 00                                        ; function index
0000053: 00                                        ; num locals
0000054: 01                                        ; function index
0000055: 00                                        ; num locals
0000050: 05                                        ; FIXUP subsection size
0000032: 23                                        ; FIXUP section size
*/

// 0061736d010000000100016000000402000a026a73036d656d0200010972656769737465727303656178037f010972656769737465727303656278037f010972656769737465727303656378037f010972656769737465727303656478037f010972656769737465727303657369037f010972656769737465727303656469037f010972656769737465727303656270037f010972656769737465727303657370037f010d7563727462617365642e646c6c0c5f776d616b65706174685f730000b003000100020700010d64656661756c744578706f72740001110a000100000b0204'

async function assemble(chunk) {
    const chunkBuffer = [];
    
    // WASM_BINARY_MAGIC
    chunkBuffer.push(0x00);
    chunkBuffer.push(0x61);
    chunkBuffer.push(0x73);
    chunkBuffer.push(0x6D);
    
    // WASM_BINARY_VERSION
    chunkBuffer.push(0x01);
    chunkBuffer.push(0x00);
    chunkBuffer.push(0x00);
    chunkBuffer.push(0x00);
    
    // section Type (0x01) 
    // for our usage the Type section is used to define possible function signatures.
    // all functions in jsprog have no inputs and outputs (the memory is used directly)
    chunkBuffer.push(0x01);
    chunkBuffer.push(0x04); // section size
    chunkBuffer.push(0x01); // one signature
    chunkBuffer.push(0x60); // function code
    chunkBuffer.push(0x00); // 0 inputs
    chunkBuffer.push(0x00); // 0 outputs
    
    // section Import (0x02)
    // count the number of unique imports (each import is either EXTERN for a function import, or a JMP/CALL with a chunk ID other than -1)
    const importList = [];
    for (const instruction of chunk.instructions) {
        if ((instruction.mnemonic === "JMP" || instruction.mnemonic === "CALL" || conditionalJumpOps.includes(instruction.mnemonic)) && instruction.operandSet[1].val !== -1 && !importList.includes(`chunk${instruction.operandSet[1]}::defaultExport`)) {
            importList.push(`chunk${instruction.operandSet[1]}::defaultExport`);
        } else if (instruction.mnemonic === "EXTERN" && !importList.includes(instruction.operandSet[0].val)) {
            importList.push(instruction.operandSet[0].val);
        }
    }
    
    chunkBuffer.push(0x02);
    chunkBuffer.push(0x00);
    
    const preImportSize = chunkBuffer.length;
    chunkBuffer.push(importList.length + 1 + 8); // import count +1 for Memory, +8 for registers
    
    // memory import
    const memModuleName = Buffer.from("js");
    const memImportName = Buffer.from("mem");
    chunkBuffer.push(memModuleName.length); // length
    for (const b of memModuleName) chunkBuffer.push(b);
    chunkBuffer.push(memImportName.length);
    for (const b of memImportName) chunkBuffer.push(b);
    
    chunkBuffer.push(0x02); // type (memory)
    chunkBuffer.push(0x00); // flags
    chunkBuffer.push(0x01); // initial size
    
    const registers = ["eax", "ebx", "ecx", "edx", "esi", "edi", "ebp", "esp"];
    const regModuleName = Buffer.from("registers");
    for (const register of registers) {
        chunkBuffer.push(regModuleName.length); // length
        for (const b of regModuleName) chunkBuffer.push(b);
        
        const regImportName = Buffer.from(register);
        chunkBuffer.push(regImportName.length); // length
        for (const b of regImportName) chunkBuffer.push(b);
        
        chunkBuffer.push(0x03); // global import
        chunkBuffer.push(0x7F); // i32
        chunkBuffer.push(0x01); // mut flag 
    }
    
    // function imports
    for (const imp of importList) {
        const moduleName = Buffer.from(imp.split("::")[0]);
        const importName = Buffer.from(imp.split("::")[1]);
        chunkBuffer.push(moduleName.length);
        for (const b of moduleName) chunkBuffer.push(b);
        chunkBuffer.push(importName.length);
        for (const b of importName) chunkBuffer.push(b);
        
        chunkBuffer.push(0x00); // import type
        chunkBuffer.push(0x00); // function signature type index
    }
    
    chunkBuffer[preImportSize - 1] = chunkBuffer.length - preImportSize; // fixup size
    
    // section Function (0x03)
    chunkBuffer.push(0x03);
    chunkBuffer.push(0x02);
    chunkBuffer.push(0x01); // one function
    chunkBuffer.push(0x00); // function signature type index
    
    // section Export (0x07)
    chunkBuffer.push(0x07);
    chunkBuffer.push(0x11);
    chunkBuffer.push(0x01); // one export
    const exportString = Buffer.from("defaultExport");
    chunkBuffer.push(exportString.length);
    for (const b of exportString) chunkBuffer.push(b);
    chunkBuffer.push(0x00); // export type
    chunkBuffer.push(importList.length); // function index
    
    // section Code (0x0A)
    chunkBuffer.push(0x0A);
    chunkBuffer.push(0x04);
    chunkBuffer.push(0x01); // function count
    chunkBuffer.push(0x00);
    chunkBuffer.push(0x00); // decl count
    chunkBuffer.push(0x0B); // END
    
    console.log(chunk.name);
    
    return chunkBuffer;
}

module.exports = {
    assemble
};