const {
	conditionalJumpOps,
	toBytesInt32
} = require('./utils.js');

/*
generated code uses a link register plus a root loop.
to branch to a given jump location, set link and br to the root.
this construct solves two problems:
- difficult to jump to a position mid-chunk
- difficult to jump backwards to arbitrary positions in a chunk
the cost is efficiency as a decent number of opcodes are spent setting up blocks and branches
there are options for microoptimizations. one already implemented is to place the branch to the first instruction first in the branch list.
it might be possible to use br_table for this with some additional work.
*/
const registers = ["eax", "ecx", "edx", "ebx", "esp", "ebp", "esi", "edi", "link"];

async function assembleInstruction(instruction, buffer, imports, targets, instrIndex) {
    switch (instruction.mnemonic) {
        case "EXTERN": {
            // we can skip setting link register as externs won't use it
            // push 0x00 to the stack (return address, unused but still need to specify)
            await assembleInstruction({mnemonic: "PUSH", operandSet: {type:'imm', val:0}});
             
            buffer.push(0x10); // call
        
            // find the function index
            const index = imports.findIndex(x => x === instruction.operandSet[0].val);
            if (index === -1) return false;
        
            buffer.push(index); // index
            break;
        } 
        case "JMP": {
            if(instruction.operandSet[2].type === "imm" && !instruction.operandSet[2].indirect) {
                // set link register
                buffer.push(0x41); // i32.const
                await addInstructionId(buffer, instruction.operandSet[2].val);
                buffer.push(0x24); // global.set
                                buffer.push(registers.indexOf("link"));
            
                // call function
                buffer.push(0x10); // call
                const index = imports.findIndex(x => x === `chunk${instruction.operandSet[1].val}::defaultExport`);
                if (index === -1) return false;
                buffer.push(index);
            } else {
                console.log("Non-immediate jump targets are not yet supported.");
                return false;
            }
            break;
        }
        case "PUSH": {
            // read ESP
            buffer.push(0x23); // global.get
            buffer.push(registers.indexOf("esp"));
                
            // value to be pushed as a const
            if (instruction.operandSet[0].type === 'imm' && !instruction.operandSet[0].indirect) {
                buffer.push(0x41); // i32.const
                await addInstructionId(buffer, instruction.operandSet[0].val);
            } else if (instruction.operandSet[0].type === 'reg' && !instruction.operandSet[0].indirect) {
                buffer.push(0x23); // global.get
                buffer.push(instruction.operandSet[0].val);
            } else {
                console.log("Unknown operand type for push instruction!");
                return false;
            }
                
            // stores value at [esp]
            if (instruction.operandSet[0].size === 32) {
                buffer.push(0x36); // i32.store
                buffer.push(0x02); // alignment
            } else if (instruction.operandSet[0].size === 16) {
                buffer.push(0x3A); // i32.store
                buffer.push(0x01); // alignment
            } else if (instruction.operandSet[0].size === 8) {
                buffer.push(0x3B); // i32.store
                buffer.push(0x00); // alignment
            } else {
                console.log("Unknown operand size for push!");
            }
                    
            buffer.push(0x00); // offset 
                
            // shift ESP based on the operand size
            buffer.push(0x23); // global.get
            buffer.push(registers.indexOf("esp"));
            buffer.push(0x41); // i32.const
            buffer.push(instruction.operandSet[0].size / 8);
            buffer.push(0x6A); // i32.add
            buffer.push(0x24); // global.set
            buffer.push(registers.indexOf("esp"));
            break;
        } 
        case "MOV": {
            // put source value on stack
            if (instruction.operandSet[1].type === 'imm' && !instruction.operandSet[1].indirect) {
                buffer.push(0x41); // i32.const
                await addInstructionId(buffer, instruction.operandSet[1].val);
            } else if (instruction.operandSet[1].type === 'reg' && !instruction.operandSet[1].indirect) {
                buffer.push(0x23); // global.get
                buffer.push(instruction.operandSet[1].val);
            } else {
                console.log("Unknown operand type for push instruction!");
                return false;
            }
            
            // apply to destination
            if (instruction.operandSet[0].type === 'imm' && !instruction.operandSet[0].indirect)
            {
                buffer.push(0x24); // global.set
                buffer.push(instruction.operandSet[0].val);
            }
            
            break;
        }
        default: {
            console.log("Failed to assemble WASM chunk, instruction has unknown mnemonic!");
            return false; 
        } 
    }
    return true;
}

async function addInstructionId(chunkBuffer, branchTarget) {
    const instructionId = [...Buffer.from(toBytesInt32(branchTarget))];
    while (instructionId[0] == 0x00 && instructionId.length > 1) instructionId.shift();
    for (const b of instructionId) chunkBuffer.push(b);
} 

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
        if ((instruction.mnemonic === "JMP" || instruction.mnemonic === "CALL" || conditionalJumpOps.includes(instruction.mnemonic)) && instruction.operandSet[1].val !== -1 && !importList.includes(`chunk${instruction.operandSet[1].val}::defaultExport`)) {
            importList.push(`chunk${instruction.operandSet[1].val}::defaultExport`);
        } else if (instruction.mnemonic === "EXTERN" && !importList.includes(instruction.operandSet[0].val)) {
            importList.push(instruction.operandSet[0].val);
        }
    }
    
    chunkBuffer.push(0x02);
    chunkBuffer.push(0x00);
    
    chunkBuffer.push(0x01); // todo: understand this
    
    const preImportSize = chunkBuffer.length;
    chunkBuffer.push(importList.length + 1 + registers.length); // import count +1 for Memory, +x for registers
    
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
    chunkBuffer.push(0x00);
    chunkBuffer.push(0x01); // function count
    
    const bodyLengthByte = chunkBuffer.length;
    chunkBuffer.push(0x00); // body length
    chunkBuffer.push(0x00); // local decl count
    
    // Handle the link-jump mechanism
    chunkBuffer.push(0x03); // root loop
    chunkBuffer.push(0x40); // void
    
    const branchTargets = chunk.branchTargets.sort();
    
    for (const branchTarget of branchTargets) {
        chunkBuffer.push(0x02); // block
        chunkBuffer.push(0x40); // void
    }
    
    for (let i = 0; i < branchTargets.length; i++) {
        const branchTarget = branchTargets[i];
        chunkBuffer.push(0x41); // i32.const
        // const value
        await addInstructionId(chunkBuffer, branchTarget);
      
        chunkBuffer.push(0x23); // global.get
        chunkBuffer.push(registers.indexOf("link")); // global index
      
        chunkBuffer.push(0x46); // i32.eq
        chunkBuffer.push(0x0D); // br_if
        chunkBuffer.push(i); // break depth
    }
    
    for (let i = 0; i < chunk.instructions.length; i++) {
        const instruction = chunk.instructions[i];
    
        // close block if this is a branch target
        if (branchTargets.includes(i)) {
            chunkBuffer.push(0x0B); // end
        }
      
        // process the instruction
        const res = await assembleInstruction(instruction, chunkBuffer, importList, branchTargets, i);
        if (!res) {
            console.log(JSON.stringify(instruction));
            return false;
        } 
    }
    
    // close the root loop
    chunkBuffer.push(0x0B); // end
    
    // close function body
    chunkBuffer.push(0x0B); // end
    
    // fix up the function size
    chunkBuffer[bodyLengthByte] = chunkBuffer.length - bodyLengthByte - 1;
    
    chunkBuffer[bodyLengthByte - 2] = chunkBuffer[bodyLengthByte] + 2;
    
    return chunkBuffer;
}

module.exports = {
    assemble
};