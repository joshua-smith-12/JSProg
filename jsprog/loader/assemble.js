const {
	conditionalJumpOps
} = require('../utils.js');
const {
	putConstOnBuffer,
	putConstOnStack,
	stackToOperand,
	operandToStack
} = require('./asmtools.js');

// puts a constant value into the target register.
function setTargetRegister(assembler, buffer, target) {
	putConstOnStack(buffer, target, 32);
	buffer.push(0x24); // global.set
	buffer.push(assembler.registers.findIndex(x => x.name === "target"));
}

async function buildInstruction(assembler, instruction, buffer, imports, targets, instrIndex) {
	// call each pre-processor registered for a given mnemonic
	for (const processor of assembler.preprocessors.filter(x => x.mnemonic === instruction.mnemonic)) {
		if (!processor.call(assembler, instruction, buffer, imports, targets, instrIndex)) return false;
	}

	// flag to indicate post-processing, writing back from t1
	const hasPostProcessors = assembler.postprocessors.some(x => x.mnemonic === instruction.mnemonic);
	let writeBackOperand = null;

	// operate on the instruction based on the mnemonic
	switch (instruction.mnemonic) {
		case "EXTERN": {
			// we can skip setting target register as externs won't use it
			buffer.push(0x10); // call
		
			// find the function index
			const index = imports.findIndex(x => x === instruction.operandSet[0].val);
			if (index === -1) return false;
		
			putConstOnBuffer(buffer, index); // index
			break;
		}
		// CALL matches JMP in our implementation
		case "CALL":
		case "JMP": {
			if(instruction.operandSet[2].type === "imm" && !instruction.operandSet[2].indirect) {
				// set target register
				setTargetRegister(assembler, buffer, instruction.operandSet[2].val);
				
				if (instruction.operandSet[1].val === -1) {
					// identify call depth and branch to the outer loop
					const numBlocks = targets.filter(x => x > instrIndex).length + 1;
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
		case "RET": {
			buffer.push(0x0F); // return
			break;
		}
		case "INT": {
			if (!operandToStack(assembler, instruction.operandSet[0], buffer)) return false;
			buffer.push(0x24); // global.set
			buffer.push(assembler.registers.findIndex(x => x.name === "t1"));
			
			// call import 2 for interrupt routine
			buffer.push(0x10);
			buffer.push(0x02);
			break;
		}
		case "JE":
		case "JNE":
		case "JA":
		case "JG": {
			// create a block
			buffer.push(0x02); 
			buffer.push(0x40);

			// invoke flag testing callback
			if (!assembler.flagTestCallback(assembler, instruction, buffer)) return false;

			// skips the subsequent JMP if the flag test callback pushed 0x01 onto WASM stack
			buffer.push(0x0D); // br_if
			buffer.push(0x00);
			
			// if this is reached, the conditional JMP is invoked
			instruction.mnemonic = "JMP";
			await buildInstruction(assembler, instruction, buffer, imports, targets, instrIndex);
			
			buffer.push(0x0B); // close block
			break;
		}
        case "MOV": {
			// put source value on stack
			if (!operandToStack(assembler, instruction.operandSet[1], buffer)) return false;
			
			// copy to the destination operand
			if (!stackToOperand(assembler, instruction.operandSet[0], buffer)) return false;
			
			break;
		}
        case "LEA": {
			if (!instruction.operandSet[1].indirect) {
				console.log("Non-indirect LEA operand is not permitted");
				return false;
			}
			
			instruction.operandSet[1].indirect = false;
			if (!operandToStack(assembler, instruction.operandSet[1], buffer)) return false;
			if (!stackToOperand(assembler, instruction.operandSet[0], buffer)) return false;
			break;
		}
		case "PUSH": {
			// value to be pushed as a const
			if (!operandToStack(assembler, instruction.operandSet[0], buffer)) return false;
				
			// stores value at [stack pointer]
			if (!stackToOperand(assembler, { type: "reg", val: assembler.stackPointerIndex, size: instruction.operandSet[0].size, indirect: true }, buffer)) return false;
				
			// shift stack pointer based on the operand size
			buffer.push(0x23); // global.get
			buffer.push(assembler.stackPointerIndex);
			putConstOnStack(buffer, instruction.operandSet[0].size / 8, 32);
			buffer.push(0x6B); // i32.sub
			buffer.push(0x24); // global.set
			buffer.push(assembler.stackPointerIndex);
			break;
		} 
		case "POP": {
			// shift stack pointer based on the operand size
			buffer.push(0x23); // global.get
			buffer.push(assembler.stackPointerIndex);
			putConstOnStack(buffer, instruction.operandSet[0].size / 8, 32);
			buffer.push(0x6A); // i32.add
			buffer.push(0x24); // global.set
			buffer.push(assembler.stackPointerIndex);
			// read from [stack pointer]
			if (!operandToStack(assembler, { type: "reg", val: assembler.stackPointerIndex, size: 32, indirect: true }, buffer)) return false;
			// pop into the desired operand
			if (!stackToOperand(assembler, instruction.operandSet[0], buffer)) return false;
			break;
		}
		case "ADD": {
			if (!operandToStack(assembler, instruction.operandSet[1], buffer)) return false;
			if (!operandToStack(assembler, instruction.operandSet[2], buffer)) return false;
			buffer.push(0x6A); // i32.add

			// if post-processors exist, put result in t1 and write-back later
			// otherwise, write-back immediately
			if (hasPostProcessors) {
				// place in t1 for temp storage
				buffer.push(0x24); // global.set
				buffer.push(assembler.registers.findIndex(x => x.name === "t1"));

				// store the destination operand
				writeBackOperand = instruction.operandSet[0];
			} else {
				if (!stackToOperand(assembler, instruction.operandSet[0], buffer)) return false;
			}
			break;
		}
        case "SUB": {
			if (!operandToStack(assembler, instruction.operandSet[1], buffer)) return false;
			if (!operandToStack(assembler, instruction.operandSet[2], buffer)) return false;
			buffer.push(0x6B); // i32.sub

			// if post-processors exist, put result in t1 and write-back later
			// otherwise, write-back immediately
			if (hasPostProcessors) {
				// place in t1 for temp storage
				buffer.push(0x24); // global.set
				buffer.push(assembler.registers.findIndex(x => x.name === "t1"));

				// store the destination operand
				writeBackOperand = instruction.operandSet[0];
			} else {
				if (!stackToOperand(assembler, instruction.operandSet[0], buffer)) return false;
			}
			break;
		}
        case "MUL": {
			// push op2 and op3
			if (!operandToStack(assembler, instruction.operandSet[1], buffer)) return false;
			if (!operandToStack(assembler, instruction.operandSet[2], buffer)) return false;
			
			// multiply
			buffer.push(0x6C); // i32.mul

			// if post-processors exist, put result in t1 and write-back later
			// otherwise, write-back immediately
			if (hasPostProcessors) {
				// place in t1 for temp storage
				buffer.push(0x24); // global.set
				buffer.push(assembler.registers.findIndex(x => x.name === "t1"));

				// store the destination operand
				writeBackOperand = instruction.operandSet[0];
			} else {
				if (!stackToOperand(assembler, instruction.operandSet[0], buffer)) return false;
			}
			break;
		}
		case "SHL": {
			// load ops and shl
			if (!operandToStack(assembler, instruction.operandSet[1], buffer)) return false;
			if (!operandToStack(assembler, instruction.operandSet[2], buffer)) return false;
			buffer.push(0x74); // i32.shl

			// if post-processors exist, put result in t1 and write-back later
			// otherwise, write-back immediately
			if (hasPostProcessors) {
				// place in t1 for temp storage
				buffer.push(0x24); // global.set
				buffer.push(assembler.registers.findIndex(x => x.name === "t1"));

				// store the destination operand
				writeBackOperand = instruction.operandSet[0];
			} else {
				if (!stackToOperand(assembler, instruction.operandSet[0], buffer)) return false;
			}
			break;
		}
		case "AND": {
			if (!operandToStack(assembler, instruction.operandSet[1], buffer)) return false;
			if (!operandToStack(assembler, instruction.operandSet[2], buffer)) return false;
			buffer.push(0x71); // i32.and

			// if post-processors exist, put result in t1 and write-back later
			// otherwise, write-back immediately
			if (hasPostProcessors) {
				// place in t1 for temp storage
				buffer.push(0x24); // global.set
				buffer.push(assembler.registers.findIndex(x => x.name === "t1"));

				// store the destination operand
				writeBackOperand = instruction.operandSet[0];
			} else {
				if (!stackToOperand(assembler, instruction.operandSet[0], buffer)) return false;
			}
			break;
		}
		case "OR": {
			if (!operandToStack(assembler, instruction.operandSet[1], buffer)) return false;
			if (!operandToStack(assembler, instruction.operandSet[2], buffer)) return false;
			buffer.push(0x72); // i32.or

			// if post-processors exist, put result in t1 and write-back later
			// otherwise, write-back immediately
			if (hasPostProcessors) {
				// place in t1 for temp storage
				buffer.push(0x24); // global.set
				buffer.push(assembler.registers.findIndex(x => x.name === "t1"));

				// store the destination operand
				writeBackOperand = instruction.operandSet[0];
			} else {
				if (!stackToOperand(assembler, instruction.operandSet[0], buffer)) return false;
			}
			break;
		}
        case "XOR": {
			if (!operandToStack(assembler, instruction.operandSet[1], buffer)) return false;
			if (!operandToStack(assembler, instruction.operandSet[2], buffer)) return false;
			buffer.push(0x73); // i32.xor

			// if post-processors exist, put result in t1 and write-back later
			// otherwise, write-back immediately
			if (hasPostProcessors) {
				// place in t1 for temp storage
				buffer.push(0x24); // global.set
				buffer.push(assembler.registers.findIndex(x => x.name === "t1"));

				// store the destination operand
				writeBackOperand = instruction.operandSet[0];
			} else {
				if (!stackToOperand(assembler, instruction.operandSet[0], buffer)) return false;
			}
			break;
		}
        case "NOT": {
			if (!operandToStack(assembler, instruction.operandSet[1], buffer)) return false;
			putConstOnStack(buffer, -1, instruction.operandSet[1].size);
			buffer.push(0x73); // i32.xor

			// if post-processors exist, put result in t1 and write-back later
			// otherwise, write-back immediately
			if (hasPostProcessors) {
				// place in t1 for temp storage
				buffer.push(0x24); // global.set
				buffer.push(assembler.registers.findIndex(x => x.name === "t1"));

				// store the destination operand
				writeBackOperand = instruction.operandSet[0];
			} else {
				if (!stackToOperand(assembler, instruction.operandSet[0], buffer)) return false;
			}
			break;
		} 
		case "TEST": {
			if (!operandToStack(assembler, instruction.operandSet[0], buffer)) return false;
			if (!operandToStack(assembler, instruction.operandSet[1], buffer)) return false;
			buffer.push(0x71); // i32.and

			// place in t1 for temp storage
			// TEST does not require write-back
			buffer.push(0x24); // global.set
			buffer.push(assembler.registers.findIndex(x => x.name === "t1"));
			break;
		}
		case "CMP": {
			if (!operandToStack(assembler, instruction.operandSet[0], buffer)) return false;
			if (!operandToStack(assembler, instruction.operandSet[1], buffer)) return false;
			buffer.push(0x6B); // i32.sub

			// place in t1 for temp storage
			// CMP does not require write-back
			buffer.push(0x24); // global.set
			buffer.push(assembler.registers.findIndex(x => x.name === "t1"));
			break;
		}
		case "XCHG": {
			// put op1 into t1
			if (!operandToStack(assembler, instruction.operandSet[0], buffer)) return false;
			buffer.push(0x24); // global.set
			buffer.push(assembler.registers.findIndex(x => x.name === "t1"));
			
			// put op2 into op1
			if (!operandToStack(assembler, instruction.operandSet[1], buffer)) return false;
			if (!stackToOperand(assembler, instruction.operandSet[0], buffer)) return false;
			
			// put t1 into op2
			buffer.push(0x23); // global.get
			buffer.push(assembler.registers.findIndex(x => x.name === "t1"));
			if (!stackToOperand(assembler, instruction.operandSet[1], buffer)) return false;
			break;
		}
		case "ICALL": {
			await buildInstruction(assembler, {mnemonic: "PUSH", operandSet: [{type:'imm', val:instruction.next, size:32}]}, buffer, imports, targets, -1);
		}
		case "IJMP": {
			if (!operandToStack(assembler, instruction.operandSet[0], buffer)) return false;
			buffer.push(0x24); // global.set
			buffer.push(assembler.registers.findIndex(x => x.name === "t1"));
			
			// call import 1 for virtual call
			buffer.push(0x10);
			buffer.push(0x01);
			break;
		}
		default: {
			const buildRes = await assembler.buildInstructionCallback(assembler, instruction, buffer, imports, targets, instrIndex, buildInstruction);
			if (!buildRes) {
				console.log("Failed to assemble WASM chunk, instruction has unknown mnemonic!");
				return false;
			}
		} 
	}

	// call each post-processor registered for a given mnemonic
	for (const processor of assembler.postprocessors.filter(x => x.mnemonic === instruction.mnemonic)) {
		if (!processor.call(assembler, instruction, buffer, imports, targets, instrIndex)) return false;
	}

	// if write-back is set, load from t1 and store in the operand
	if (writeBackOperand) {
		buffer.push(0x23); // global.get
		buffer.push(assembler.registers.findIndex(x => x.name === "t1"));
		if (!stackToOperand(assembler, writeBackOperand, buffer)) return false;
	}

	return true;
}

async function buildWasm(assembler, chunk, debuggerEnabled) {
	// buffer to store all bytes comprising the chunk
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
	chunkBuffer.push(0x02);
	const importList = [];
	// these are extra imports added to aid the runtime
	importList.push("system::debugger");
	importList.push("system::vcall");
	importList.push("system::interrupt");
	// iterate all instructions in the chunk to find branch instructions
	for (const instruction of chunk.instructions) { 
		// if a branch leads to another chunk, add that chunk's export to the import list
		// otherwise, an EXTERN marks an import from a DLL
		if ((instruction.mnemonic === "JMP" || instruction.mnemonic === "CALL" || conditionalJumpOps.includes(instruction.mnemonic)) && instruction.operandSet[0].type !== 'reg' && instruction.operandSet[1].val !== -1 && !importList.includes(`chunk${instruction.operandSet[1].val}::defaultExport`)) {
			importList.push(`chunk${instruction.operandSet[1].val}::defaultExport`);
		} else if (instruction.mnemonic === "EXTERN" && !importList.includes(instruction.operandSet[0].val)) {
			importList.push(instruction.operandSet[0].val);
		}
	}

	// temp buffer which will be appended later (need to be able to compute section size)
	const tempImportBuffer = [];
	// push the number of imports in total
	tempImportBuffer.push(importList.length + 1 + assembler.registers.length + assembler.segments.length); // import count +1 for Memory, +x for registers, +y for segments
	
	// memory import has a fixed name
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
	for (const register of assembler.registers) {
		tempImportBuffer.push(regModuleName.length); // length
		for (const b of regModuleName) tempImportBuffer.push(b);
		
		const regImportName = Buffer.from(register.name);
		tempImportBuffer.push(regImportName.length); // length
		for (const b of regImportName) tempImportBuffer.push(b);
		
		tempImportBuffer.push(0x03); // global import
		if (register.type === "i64") {
			tempImportBuffer.push(0x7E); // i64
		} else if (register.type === "i32") {
			tempImportBuffer.push(0x7F); // i32
		} else {
			console.log(`Unrecognized type ${register.type} for register ${register.name}.`);
			return false;
		}
		tempImportBuffer.push(0x01); // mut flag 
	}
	
	const segModuleName = Buffer.from("segments");
	for (const segment of assembler.segments) {
		tempImportBuffer.push(segModuleName.length); // length
		for (const b of segModuleName) tempImportBuffer.push(b);
		
		const segImportName = Buffer.from(segment.name);
		tempImportBuffer.push(segImportName.length); // length
		for (const b of segImportName) tempImportBuffer.push(b);
		
		tempImportBuffer.push(0x03); // global import
		if (segment.type === "i64") {
			tempImportBuffer.push(0x7E); // i64
		} else if (segment.type === "i32") {
			tempImportBuffer.push(0x7F); // i32
		} else {
			console.log(`Unrecognized type ${segment.type} for segment ${segment.name}.`);
			return false;
		}
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
	
	// Handle the target-jump mechanism
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
		tempFuncBuffer.push(assembler.registers.findIndex(x => x.name === "target")); // global index
	  
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
			putConstOnStack(tempFuncBuffer, i, 32);
			tempFuncBuffer.push(0x24); // global.set
			tempFuncBuffer.push(assembler.registers.findIndex(x => x.name === "t2"));
			tempFuncBuffer.push(0x10); // call
			tempFuncBuffer.push(0x00); // debugger index
		}
	  
		// process the instruction
		let res = false;
		try {
			res = await buildInstruction(assembler, instruction, tempFuncBuffer, importList, branchTargets, i);
		} catch (error) {
			console.log(error);
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

class Assembler {
	// core configuration: 
	// defines the registers and segment selectors available to this assembler
	registers = [];
	segments = [];
	// defines the index of the register used as the stack pointer
	stackPointerIndex = 0;
	
	// pre- and post-processors are to allow custom configuration depending on architecture
	preprocessors = [];
	postprocessors = [];

	// callbacks which can be used to implement specific functionality missing in the default assembly
	stackToOperandCallback = () => false;
	operandToStackCallback = () => false;
	buildInstructionCallback = () => false;
	flagTestCallback = () => false;

	// updates the set of registers in use by this assembler, including the target register and temporary registers.
	SetRegisters(regSet) {
		this.registers = regSet.concat([
			{
				name: "target",
				type: "i32"
			},
			{
				name: "t1",
				type: "i32"
			},
			{
				name: "t2",
				type: "i32"
			},
			{
				name: "t64",
				type: "i64"
			}
		]);
	}

	SetSegments(segSet) {
		this.segments = segSet;
	}

	SetStackPointer(name) {
		this.stackPointerIndex = this.registers.findIndex(x => x.name === name);
		if (this.stackPointerIndex === -1) console.log(`Warning: stack pointer index set to -1, no such register ${name}`);
	}

	AddPreProcessor(mnemonic, f) {
		this.preprocessors.push({ mnemonic, call: f });
	}

	AddPostProcessor(mnemonic, f) {
		this.postprocessors.push({ mnemonic, call: f });
	}

	SetOperandCallbacks(f1, f2) {
		this.operandToStackCallback = f1;
		this.stackToOperandCallback = f2;
	}

	SetBuildInstructionCallback(f) {
		this.buildInstructionCallback = f;
	}

	SetFlagTestCallback(f) {
		this.flagTestCallback = f;
	}

	async AssembleChunk(chunk, debugEnabled) {
		return await buildWasm(this, chunk, debugEnabled);
	}
};

module.exports = {
	Assembler
};