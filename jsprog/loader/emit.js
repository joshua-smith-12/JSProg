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
const registers = ["eax", "ecx", "edx", "ebx", "esp", "ebp", "esi", "edi", "link", "cf", "pf", "zf", "sf", "of", "af", "t1", "t2"];

function sizedLoad(buffer, size) {
    if (size === 32) {
        buffer.push(0x28); // i32.load
        buffer.push(0x02); // alignment
    } else if (size === 16) {
        buffer.push(0x2F); // i32.load16_u
        buffer.push(0x01); // alignment
    } else if (size === 8) {
        buffer.push(0x2D); // i32.load8_u
        buffer.push(0x00); // alignment
    } else {
        console.log("Unknown operand size for sized load!");
        return false;
    }
    buffer.push(0x00); // offset
    return true;
}

function sizedStore(buffer, size) {
    if (size === 32) {
        buffer.push(0x36); // i32.store
        buffer.push(0x02); // alignment
    } else if (size === 16) {
        buffer.push(0x3A); // i32.store16
        buffer.push(0x01); // alignment
    } else if (size === 8) {
        buffer.push(0x3B); // i32.store8
        buffer.push(0x00); // alignment
    } else {
        console.log("Unknown operand size for sized store!");
        return false;
    }
    buffer.push(0x00); // offset
    return true;
}

// takes an operand (imm or reg) and places the value on the WASM stack.
function operandToStack(operand, prefixes, buffer) {
    let displacement = operand['displace'];
    
    if (operand.type === "imm") {
        if (operand.indirect) {
            buffer.push(0x41); // i32.const
            putConstOnBuffer(buffer, operand.val);
            if (!sizedLoad(buffer, operand.size)) return false;
        } else {
            buffer.push(0x41); // i32.const
            putConstOnBuffer(buffer, operand.val);
        }
    } else if (operand.type === "reg") {
        if (operand.indirect) {
            buffer.push(0x23); // global.get
            buffer.push(operand.val);
            
            if (displacement && displacement > 0) {
                buffer.push(0x41); // i32.const
                putConstOnBuffer(displacement);
                buffer.push(0x6A); // i32.add
            } else if (displacement) {
                displacement = displacement * -1;
                buffer.push(0x41); // i32.const
                putConstOnBuffer(buffer, displacement);
                buffer.push(0x6B); // i32.sub
            } 
            if (!sizedLoad(buffer, operand.size)) return false;
        } else {
            buffer.push(0x23); // global.get
            buffer.push(operand.val);
        }
    } else if (operand.type === 'moffs') {
        // check prefix count
        if (prefixes.length === 0) {
            operand.type = 'imm';
            return operandToStack(operand, prefixes, buffer);
        }
        // get the prefix and offset into t1 and t2
        buffer.push(0x41); // i32.const
        putConstOnBuffer(buffer, prefixes[0]);
        buffer.push(0x23); // global.get
        buffer.push(registers.indexOf("t1"));
        
        buffer.push(0x41); // i32.const
        putConstOnBuffer(buffer, operand.val);
        buffer.push(0x23); // global.get
        buffer.push(registers.indexOf("t2"));
        
        // call import 0 for os-provided function
        buffer.push(0x10);
        buffer.push(0x00);
    } else {
        console.log("Unknown operand type to be placed on stack!");
        return false;
    }
    
    return true;
}

// assuming a value exists on the WASM stack, moves this value into an operand.
function stackToOperand(operand, prefixes, buffer) {
    if (operand.type === "imm") {
        if (operand.indirect) {
            // read the value into temp register
            buffer.push(0x24); // global.set
            buffer.push(registers.indexOf("t1"));
            
            // set the address to write to
            buffer.push(0x41); // i32.const
            putConstOnBuffer(buffer, operand.val);
            
            // restore value onto stack
            buffer.push(0x23); // global.get
            buffer.push(registers.indexOf("t1"));
            
            // store
            if (!sizedStore(buffer, operand.size)) return false;
        } else {
            console.log("Cannot store value in a direct immediate.");
            return false;
        }
    } else if (operand.type === "reg") {
        if (operand.indirect) {
            // read the value into temp register
            buffer.push(0x24); // global.set
            buffer.push(registers.indexOf("t1"));
            
            // set the address to write to
            buffer.push(0x23); // global.get
            buffer.push(operand.val);
            
            // restore value onto stack
            buffer.push(0x23); // global.get
            buffer.push(registers.indexOf("t1"));
            
            // store
            if (!sizedStore(buffer, operand.size)) return false;
        } else {
            buffer.push(0x24); // global.set
            buffer.push(operand.val);
        }
    } else if (operand.type === 'moffs') {
        // check prefix count
        if (prefixes.length === 0) {
            operand.type = 'imm';
            return stackToOperand(operand, prefixes, buffer);
        }
        // get the prefix and offset into t1 and t2
        buffer.push(0x41); // i32.const
        putConstOnBuffer(buffer, prefixes[0]);
        buffer.push(0x23); // global.get
        buffer.push(registers.indexOf("t1"));
        
        buffer.push(0x41); // i32.const
        putConstOnBuffer(buffer, operand.val);
        buffer.push(0x23); // global.get
        buffer.push(registers.indexOf("t2"));
        
        // call import 1 for os-provided function
        buffer.push(0x10);
        buffer.push(0x01);
    } else {
        console.log("Unknown operand type to be stored in operand!");
        return false;
    }
    
    return true;
}

function setLinkRegister(buffer, target) {
    buffer.push(0x41); // i32.const
    putConstOnBuffer(buffer, target);
    buffer.push(0x24); // global.set
    buffer.push(registers.indexOf("link"));
}

function setParityFlag(buffer) {
    // PF - parity
    // set if the number of bits set in low byte of result is even
    buffer.push(0x23); // global.get
    buffer.push(registers.indexOf("t1"));
    buffer.push(0x41); // i32.const
    putConstOnBuffer(buffer, 0xFF);
    buffer.push(0x71); // i32.and
    buffer.push(0x69); // i32.popcnt
    buffer.push(0x41); // i32.const
    buffer.push(0x02);
    buffer.push(0x70); // i32.rem_u
    buffer.push(0x41); // i32.const
    buffer.push(0x01);
    buffer.push(0x73); // i32.xor
            
    // update pf flag
    buffer.push(0x24); // global.set
    buffer.push(registers.indexOf("pf"));
}

function setZeroFlag(buffer) {
    // ZF - zero
    // set if the result is zero
    buffer.push(0x23); // global.get
    buffer.push(registers.indexOf("t1"));
    buffer.push(0x45); // i32.eqz
    // update zf flag
    buffer.push(0x24); // global.set
    buffer.push(registers.indexOf("zf"));
}

function setSignFlag(buffer) {
    // SF - sign
    // set if the result is signed negative
    buffer.push(0x23); // global.get
    buffer.push(registers.indexOf("t1"));
    buffer.push(0x41); // i32.const
    buffer.push(0x00);
    buffer.push(0x48); // i32.lt_s
    // update sf flag
    buffer.push(0x24); // global.set
    buffer.push(registers.indexOf("sf"));
}

function setCarryFlag(buffer, first, second) {
    // CF - carry
    // set if op 2 is smaller than op 1
    if (!operandToStack(second, [], buffer)) return false;
    if (!operandToStack(first, [], buffer)) return false;
    buffer.push(0x49); // i32.lt_u
    // update cf flag
    buffer.push(0x24); // global.set
    buffer.push(registers.indexOf("cf"));
}

function setOverflowFlag(buffer, first) {
    // OF - overflow
    // set if sign bit of result does not match sign bit of op1
    
    // get sign bit of op1
    if (!operandToStack(first, [], buffer)) return false;
    buffer.push(0x41); // i32.const
    putConstOnBuffer(buffer, 0x80000000);
    buffer.push(0x71); // i32.and
    
    // get sign bit of result
    buffer.push(0x23); // global.get
    buffer.push(registers.indexOf("t1"));
    buffer.push(0x41); // i32.const
    putConstOnBuffer(buffer, 0x80000000);
    buffer.push(0x71); // i32.and
    
    // xor to confirm sign bits are different
    buffer.push(0x73); // i32.xor
    
    // update of flag
    buffer.push(0x24); // global.set
    buffer.push(registers.indexOf("of"));
}

async function assembleInstruction(instruction, buffer, imports, targets, instrIndex) {
    switch (instruction.mnemonic) {
        case "EXTERN": {
            // we can skip setting link register as externs won't use it
            // push return address to the stack (unused but still need to specify)
            await assembleInstruction({mnemonic: "PUSH", operandSet: [{type:'imm', val:instruction.next, size:32}]}, buffer, imports, targets, -1);
             
            buffer.push(0x10); // call
        
            // find the function index
            const index = imports.findIndex(x => x === instruction.operandSet[0].val);
            if (index === -1) return false;
        
            putConstOnBuffer(buffer, index); // index
            break;
        }
        // CALL matches JMP in our implementation but requires a return address pushed
        case "CALL": {
            await assembleInstruction({mnemonic: "PUSH", operandSet: [{type:'imm', val:instruction.next, size:32}]}, buffer, imports, targets, -1);
        } 
        case "JMP": {
            if(instruction.operandSet[2].type === "imm" && !instruction.operandSet[2].indirect) {
                // set link register
                setLinkRegister(buffer, instruction.operandSet[2].val);
                
                if (instruction.operandSet[1].val === -1) {
                    // identify call depth and branch to the outer loop
                    const numBlocks = targets.filter(x => x > instrIndex).length;
                    buffer.push(0x0C); // br
                    putConstOnBuffer(buffer, numBlocks);
                } else { 
                    // call function
                    buffer.push(0x10); // call 
                    const index = imports.findIndex(x => x === `chunk${instruction.operandSet[1].val}::defaultExport`);
                    if (index === -1) {
                        console.log("Failed to identify import for chunk in instruction.");
                        return false;
                    } 
                    putConstOnBuffer(buffer, index);
                } 
            } else {
                console.log("Non-immediate jump targets are not yet supported.");
                return false;
            }
            break;
        }
        case "PUSH": {    
            // value to be pushed as a const
            if (!operandToStack(instruction.operandSet[0], instruction.prefixSet, buffer)) return false;
                
            // stores value at [esp]
            if (!stackToOperand({type: "reg", val: registers.indexOf("esp"), size: instruction.operandSet[0].size, indirect: true}, [], buffer)) return false;
                
            // shift ESP based on the operand size
            buffer.push(0x23); // global.get
            buffer.push(registers.indexOf("esp"));
            buffer.push(0x41); // i32.const
            putConstOnBuffer(buffer, instruction.operandSet[0].size / 8);
            buffer.push(0x6A); // i32.add
            buffer.push(0x24); // global.set
            buffer.push(registers.indexOf("esp"));
            break;
        } 
        case "MOV": 
        case "MOVZX": {
            // put source value on stack
            if (!operandToStack(instruction.operandSet[1], instruction.prefixSet, buffer)) return false;
            
            // copy to the destination operand
            if (!stackToOperand(instruction.operandSet[0], instruction.prefixSet, buffer)) return false;
            
            break;
        }
        case "POP": {
            // read from [ESP]
            if (!operandToStack({type: "reg", val: registers.indexOf("esp"), size: 32, indirect: true}, instruction.prefixSet, buffer)) return false;
            // pop into the desired operand
            if (!stackToOperand(instruction.operandSet[0], instruction.prefixSet, buffer)) return false;
            
            // shift ESP based on the operand size
            buffer.push(0x23); // global.get
            buffer.push(registers.indexOf("esp"));
            buffer.push(0x41); // i32.const
            putConstOnBuffer(buffer, instruction.operandSet[0].size / 8);
            buffer.push(0x6B); // i32.sub
            buffer.push(0x24); // global.set
            buffer.push(registers.indexOf("esp"));
            break;
        }
        case "RET": {
            buffer.push(0x0F);
            break;
        }
        case "ADD": {
            if (!operandToStack(instruction.operandSet[0], instruction.prefixSet, buffer)) return false;
            if (!operandToStack(instruction.operandSet[1], instruction.prefixSet, buffer)) return false;
            buffer.push(0x6A); // i32.add
            
            // place in t1 for temp storage
            buffer.push(0x24); // global.set
            buffer.push(registers.indexOf("t1"));
            
            // calculate and set flags
            // CF - carry - needs to be set manually as it differs from CMP
            // set if a+b overflows unsigned
            // detect by checking if result is less than both a and b (unsigned)
            // compare to first operand
            buffer.push(0x23); // global.get
            buffer.push(registers.indexOf("t1"));
            if (!operandToStack(instruction.operandSet[0], instruction.prefixSet, buffer)) return false;
            buffer.push(0x49); // i32.lt_u
            
            // compare to second operand
            buffer.push(0x23); // global.get
            buffer.push(registers.indexOf("t1"));
            if (!operandToStack(instruction.operandSet[1], instruction.prefixSet, buffer)) return false;
            buffer.push(0x49); // i32.lt_u
            
            // take logical AND of both results and store in cf
            buffer.push(0x71); // i32.and
            buffer.push(0x24); // global.set
            buffer.push(registers.indexOf("cf"));
            
            // PF - parity
            setParityFlag(buffer); 
            
            // ZF - zero
            setZeroFlag(buffer);
            
            // SF - sign
            setSignFlag(buffer);
            
            // OF - overflow
            setOverflowFlag(buffer, instruction.operandSet[0]);
            
            // restore from t1 and put into destination operand
            buffer.push(0x23); // global.get
            buffer.push(registers.indexOf("t1"));
            if (!stackToOperand(instruction.operandSet[0], instruction.prefixSet, buffer)) return false;
            
            break;
        }
        case "XOR": {
            if (!operandToStack(instruction.operandSet[0], instruction.prefixSet, buffer)) return false;
            if (!operandToStack(instruction.operandSet[1], instruction.prefixSet, buffer)) return false;
            buffer.push(0x73); // i32.xor
            
            // store temporarily in t1
            buffer.push(0x24); // global.set
            buffer.push(registers.indexOf("t1"));
            
            // reset of and cf flags
            buffer.push(0x41); // i32.const
            buffer.push(0x00);
            buffer.push(0x24); // global.set
            buffer.push(registers.indexOf("of"));
            buffer.push(0x41); // i32.const
            buffer.push(0x00);
            buffer.push(0x24); // global.set
            buffer.push(registers.indexOf("cf"));
            
            // set relevant flags based on result
            // PF - parity
            setParityFlag(buffer); 
            
            // ZF - zero
            setZeroFlag(buffer);
            
            // SF - sign
            setSignFlag(buffer);
            
            // restore from t1 and put into destination operand
            buffer.push(0x23); // global.get
            buffer.push(registers.indexOf("t1"));
            if (!stackToOperand(instruction.operandSet[0], instruction.prefixSet, buffer)) return false;
            break;
        }
        case "AND": {
            if (!operandToStack(instruction.operandSet[0], instruction.prefixSet, buffer)) return false;
            if (!operandToStack(instruction.operandSet[1], instruction.prefixSet, buffer)) return false;
            buffer.push(0x71); // i32.and
            
            // store temporarily in t1
            buffer.push(0x24); // global.set
            buffer.push(registers.indexOf("t1"));
            
            // reset of and cf flags
            buffer.push(0x41); // i32.const
            buffer.push(0x00);
            buffer.push(0x24); // global.set
            buffer.push(registers.indexOf("of"));
            buffer.push(0x41); // i32.const
            buffer.push(0x00);
            buffer.push(0x24); // global.set
            buffer.push(registers.indexOf("cf"));
            
            // set relevant flags based on result
            // PF - parity
            setParityFlag(buffer); 
            
            // ZF - zero
            setZeroFlag(buffer);
            
            // SF - sign
            setSignFlag(buffer);
            
            // restore from t1 and put into destination operand
            buffer.push(0x23); // global.get
            buffer.push(registers.indexOf("t1"));
            if (!stackToOperand(instruction.operandSet[0], instruction.prefixSet, buffer)) return false;
            break;
        }
        case "OR": {
            if (!operandToStack(instruction.operandSet[0], instruction.prefixSet, buffer)) return false;
            if (!operandToStack(instruction.operandSet[1], instruction.prefixSet, buffer)) return false;
            buffer.push(0x72); // i32.or
            
            // store temporarily in t1
            buffer.push(0x24); // global.set
            buffer.push(registers.indexOf("t1"));
            
            // reset of and cf flags
            buffer.push(0x41); // i32.const
            buffer.push(0x00);
            buffer.push(0x24); // global.set
            buffer.push(registers.indexOf("of"));
            buffer.push(0x41); // i32.const
            buffer.push(0x00);
            buffer.push(0x24); // global.set
            buffer.push(registers.indexOf("cf"));
            
            // set relevant flags based on result
            // PF - parity
            setParityFlag(buffer); 
            
            // ZF - zero
            setZeroFlag(buffer);
            
            // SF - sign
            setSignFlag(buffer);
            
            // restore from t1 and put into destination operand
            buffer.push(0x23); // global.get
            buffer.push(registers.indexOf("t1"));
            if (!stackToOperand(instruction.operandSet[0], instruction.prefixSet, buffer)) return false;
            break;
        }
        case "TEST": {
            if (!operandToStack(instruction.operandSet[0], instruction.prefixSet, buffer)) return false;
            if (!operandToStack(instruction.operandSet[1], instruction.prefixSet, buffer)) return false;
            buffer.push(0x71); // i32.and
            
            // store temporarily in t1
            buffer.push(0x24); // global.set
            buffer.push(registers.indexOf("t1"));
            
            // reset of and cf flags
            buffer.push(0x41); // i32.const
            buffer.push(0x00);
            buffer.push(0x24); // global.set
            buffer.push(registers.indexOf("of"));
            buffer.push(0x41); // i32.const
            buffer.push(0x00);
            buffer.push(0x24); // global.set
            buffer.push(registers.indexOf("cf"));
            
            // set relevant flags based on result
            // PF - parity
            setParityFlag(buffer); 
            
            // ZF - zero
            setZeroFlag(buffer);
            
            // SF - sign
            setSignFlag(buffer);
            
            break;
        }
        case "LEA": {
            console.log(instruction);
            if (!instruction.operandSet[1].indirect) {
                console.log("Non-indirect LEA operand is not permitted");
                return false;
            }
            
            instruction.operandSet[1].indirect = false;
            if (!operandToStack(instruction.operandSet[1], instruction.prefixSet, buffer)) return false;
            if (!stackToOperand(instruction.operandSet[0], instruction.prefixSet, buffer)) return false;
            break;
        }
        case "JNE":
        case "JNZ": {
            // create a block
            buffer.push(0x02); 
            buffer.push(0x40);
            // get ZF
            buffer.push(0x23); // global.get
            buffer.push(registers.indexOf("zf"));
            // test if zero and break if so
            buffer.push(0x45); // i32.eqz
            buffer.push(0x0D); // br_if
            buffer.push(0x00);
            
            // value is not zero, perform regular JUMP
            instruction.mnemonic = "JMP";
            await assembleInstruction(instruction, buffer, imports, targets, instrIndex);
            
            buffer.push(0x0B); // close block
            break;
        }
        case "JE":
        case "JZ": {
            // create a block
            buffer.push(0x02); 
            buffer.push(0x40);
            // get ZF
            buffer.push(0x23); // global.get
            buffer.push(registers.indexOf("zf"));
            // test if zero, then invert result and break if so
            buffer.push(0x45); // i32.eqz
            buffer.push(0x41); // i32.const
            buffer.push(0x01);
            buffer.push(0x73); // i32.xor
            buffer.push(0x0D); // br_if
            buffer.push(0x00);
            
            // value is zero, perform regular JUMP
            instruction.mnemonic = "JMP";
            await assembleInstruction(instruction, buffer, imports, targets, instrIndex);
            
            buffer.push(0x0B); // close block
            break;
        }
        case "CMP": {
            if (!operandToStack(instruction.operandSet[0], instruction.prefixSet, buffer)) return false;
            if (!operandToStack(instruction.operandSet[1], instruction.prefixSet, buffer)) return false;
            buffer.push(0x6B); // i32.sub
            
            // store temporarily in t1
            buffer.push(0x24); // global.set
            buffer.push(registers.indexOf("t1"));
            
            // set relevant flags based on result
            // PF - parity
            setParityFlag(buffer); 
            
            // ZF - zero
            setZeroFlag(buffer);
            
            // SF - sign
            setSignFlag(buffer);
            
            // CF - carry
            setCarryFlag(buffer, instruction.operandSet[0], instruction.operandSet[1]);
            
            // OF - overflow
            setOverflowFlag(buffer, instruction.operandSet[0]);
            break;
        }
        case "NOT": {
            if (!operandToStack(instruction.operandSet[0], instruction.prefixSet, buffer)) return false;
            buffer.push(0x41); // i32.const
            putConstOnBuffer(buffer, 0xFFFFFFFF);
            buffer.push(0x73); // i32.xor
            
            if (!stackToOperand(instruction.operandSet[0], instruction.prefixSet, buffer)) return false;
            break;
        } 
        case "SAL":
        case "SHL": {
            if (!operandToStack(instruction.operandSet[0], instruction.prefixSet, buffer)) return false;
            if (!operandToStack(instruction.operandSet[1], instruction.prefixSet, buffer)) return false;
            // sub 1 from shift count to help set CF
            buffer.push(0x41); // i32.const
            putConstOnBuffer(buffer, 1);
            buffer.push(0x6B); // i32.sub
            
            buffer.push(0x74); // i32.shl
            
            // compute CF - upper bit
            buffer.push(0x41); // i32.const
            putConstOnBuffer(buffer, 0x80000000);
            buffer.push(0x71); // i32.and
            
            // set CF
            buffer.push(0x24); // global.set
            buffer.push(registers.indexOf("cf"));
            
            // reload original and shl
            if (!operandToStack(instruction.operandSet[0], instruction.prefixSet, buffer)) return false;
            if (!operandToStack(instruction.operandSet[1], instruction.prefixSet, buffer)) return false;
            buffer.push(0x74); // i32.shl
            
            // store temporarily in t1
            buffer.push(0x24); // global.set
            buffer.push(registers.indexOf("t1"));
            
            // set relevant flags based on result
            // PF - parity
            setParityFlag(buffer); 
            
            // ZF - zero
            setZeroFlag(buffer);
            
            // SF - sign
            setSignFlag(buffer);
            
            // restore from t1 and put into destination operand
            buffer.push(0x23); // global.get
            buffer.push(registers.indexOf("t1"));
            if (!stackToOperand(instruction.operandSet[0], instruction.prefixSet, buffer)) return false;
            break;
        }
        case "ICALL": {
            await assembleInstruction({mnemonic: "PUSH", operandSet: [{type:'imm', val:instruction.next, size:32}]}, buffer, imports, targets, -1);
        }
        case "IJMP": {
            if (!operandToStack(instruction.operandSet[0], instruction.prefixSet, buffer)) return false;
            buffer.push(0x24); // global.set
            buffer.push(registers.indexOf("t1"));
            
            // call import 3 for virtual call
            buffer.push(0x10);
            buffer.push(0x03);
            break;
        }
        default: {
            console.log("Failed to assemble WASM chunk, instruction has unknown mnemonic!");
            return false; 
        } 
    }
    return true;
}

// puts a const onto the buffer by bytes
// consts are encoded with LEB encoding
function encodeSignedLeb128FromInt32(value) {
  value |= 0;
  const result = [];
  while (true) {
    const byte_ = value & 0x7f;
    value >>= 7;
    if (
      (value === 0 && (byte_ & 0x40) === 0) ||
      (value === -1 && (byte_ & 0x40) !== 0)
    ) {
      result.push(byte_);
      return result;
    }
    result.push(byte_ | 0x80);
  }
}

function putConstOnBuffer(chunkBuffer, constValue) {
    const byteBuffer = encodeSignedLeb128FromInt32(constValue);
    for (const b of byteBuffer) chunkBuffer.push(b);
} 



async function assemble(chunk, debuggerEnabled) {
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
    importList.push("system::readSegment");
    importList.push("system::writeSegment");
    importList.push("system::debugger");
    importList.push("system::vcall");
    for (const instruction of chunk.instructions) { 
        if ((instruction.mnemonic === "JMP" || instruction.mnemonic === "CALL" || conditionalJumpOps.includes(instruction.mnemonic)) && instruction.operandSet[0].type !== 'reg' && instruction.operandSet[1].val !== -1 && !importList.includes(`chunk${instruction.operandSet[1].val}::defaultExport`)) {
            importList.push(`chunk${instruction.operandSet[1].val}::defaultExport`);
        } else if (instruction.mnemonic === "EXTERN" && !importList.includes(instruction.operandSet[0].val)) {
            importList.push(instruction.operandSet[0].val);
        }
    }
    
    chunkBuffer.push(0x02);
    const tempImportBuffer = [];
    
    tempImportBuffer.push(importList.length + 1 + registers.length); // import count +1 for Memory, +x for registers
    
    // memory import
    const memModuleName = Buffer.from("js");
    const memImportName = Buffer.from("mem");
    tempImportBuffer.push(memModuleName.length); // length
    for (const b of memModuleName) tempImportBuffer.push(b);
    tempImportBuffer.push(memImportName.length);
    for (const b of memImportName) tempImportBuffer.push(b);
    
    tempImportBuffer.push(0x02); // type (memory)
    tempImportBuffer.push(0x00); // flags
    tempImportBuffer.push(0x01); // initial size
    
    const regModuleName = Buffer.from("registers");
    for (const register of registers) {
        tempImportBuffer.push(regModuleName.length); // length
        for (const b of regModuleName) tempImportBuffer.push(b);
        
        const regImportName = Buffer.from(register);
        tempImportBuffer.push(regImportName.length); // length
        for (const b of regImportName) tempImportBuffer.push(b);
        
        tempImportBuffer.push(0x03); // global import
        tempImportBuffer.push(0x7F); // i32
        tempImportBuffer.push(0x01); // mut flag 
    }
    
    // function imports
    for (const imp of importList) {
        const moduleName = Buffer.from(imp.split("::")[0]);
        const importName = Buffer.from(imp.split("::")[1]);
        tempImportBuffer.push(moduleName.length);
        for (const b of moduleName) tempImportBuffer.push(b);
        tempImportBuffer.push(importName.length);
        for (const b of importName) tempImportBuffer.push(b);
        
        tempImportBuffer.push(0x00); // import type
        tempImportBuffer.push(0x00); // function signature type index
    }
    
    putConstOnBuffer(chunkBuffer, tempImportBuffer.length);
    for (const b of tempImportBuffer) chunkBuffer.push(b);
    
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
    
    const tempCodeBuffer = [];
    tempCodeBuffer.push(0x01); // function count
    
    const tempFuncBuffer = [];
    tempFuncBuffer.push(0x00); // local decl count
    
    // Handle the link-jump mechanism
    tempFuncBuffer.push(0x03); // root loop
    tempFuncBuffer.push(0x40); // void
    
    const branchTargets = chunk.branchTargets.sort();
    
    for (const branchTarget of branchTargets) {
        tempFuncBuffer.push(0x02); // block
        tempFuncBuffer.push(0x40); // void
    }
    
    for (let i = 0; i < branchTargets.length; i++) {
        const branchTarget = branchTargets[i];
        tempFuncBuffer.push(0x41); // i32.const
        // const value
        putConstOnBuffer(tempFuncBuffer, branchTarget);
      
        tempFuncBuffer.push(0x23); // global.get
        tempFuncBuffer.push(registers.indexOf("link")); // global index
      
        tempFuncBuffer.push(0x46); // i32.eq
        tempFuncBuffer.push(0x0D); // br_if
        tempFuncBuffer.push(i); // break depth
    }
    
    for (let i = 0; i < chunk.instructions.length; i++) {
        const instruction = chunk.instructions[i];
    
        // close block if this is a branch target
        if (branchTargets.includes(i)) {
            tempFuncBuffer.push(0x0B); // end
        }
        
        // include a call to the debugger if it is enabled
        if (debuggerEnabled) {
            tempFuncBuffer.push(0x41); // i32.const
            putConstOnBuffer(tempFuncBuffer, i);
            tempFuncBuffer.push(0x24); // global.set
            tempFuncBuffer.push(registers.indexOf("t2"));
            tempFuncBuffer.push(0x10); // call
            tempFuncBuffer.push(0x02); // debugger index
        }
      
        // process the instruction
        let res = false;
        try {
            res = await assembleInstruction(instruction, tempFuncBuffer, importList, branchTargets, i);
        } finally { 
            if (!res) {
                console.log(JSON.stringify(instruction));
                return false;
            } 
        } 
    }
    
    // close the root loop
    tempFuncBuffer.push(0x0B); // end
    
    // close function body
    tempFuncBuffer.push(0x0B); // end
    
    // fix up the function size
    putConstOnBuffer(tempCodeBuffer, tempFuncBuffer.length);
    for (const b of tempFuncBuffer) tempCodeBuffer.push(b);
    
    // fix up the section size
    putConstOnBuffer(chunkBuffer, tempCodeBuffer.length);
    for (const b of tempCodeBuffer) chunkBuffer.push(b);
    
    return chunkBuffer;
}

module.exports = {
    assemble
};