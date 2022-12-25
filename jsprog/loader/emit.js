const {
	conditionalJumpOps
} = require('./utils.js');

/*
freebranch sample
uses a link register plus a root loop.
to branch to a given jump location, set link and br to the root.
this construct solves two problems:
- difficult to jump to a position mid-chunk
- difficult to jump backwards to arbitrary positions in a chunk
the cost is efficiency as a decent number of opcodes are spent setting up blocks and branches  
(module
  (global $link (mut i32) (i32.const 0))
  (func (export "addTwo") (local i32)
    (loop $root
      (block $b5
        (block $b3
          (block $b2
            i32.const 2
            global.get $link
            i32.eq
            br_if $b2
            i32.const 3
            global.get $link
            i32.eq 
            br_if $b3
            i32.const 5
            global.get $link
            i32.eq
            br_if $b5
            ;; i1: ADD EAX, 1
            local.get 0
            i32.const 1
            i32.add
            local.set 0
          )
          ;; i2: MOV EAX, 5
          i32.const 5
          local.set 0
        )
        ;; i3: MOV EAX, 0
        i32.const 0
        local.set 0
        ;; i4: JMP $b2
        i32.const 2
        global.set $link
        br $root
      )
      ;; i5: MOV EAX, 1
      i32.const 1
      local.set 0
    )
  )
)
*/

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
    
    chunkBuffer.push(0x01); // todo: understand this
    
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
    
    chunkBuffer[preImportSize - 2] = chunkBuffer.length - preImportSize; // fixup size
    
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
    chunkBuffer.push(0x02); // body length
    chunkBuffer.push(0x00); // decl count
    chunkBuffer.push(0x0B); // END
    
    console.log(chunk.name);
    
    return chunkBuffer;
}

module.exports = {
    assemble
};