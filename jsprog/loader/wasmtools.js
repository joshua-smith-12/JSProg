// encodes an input integer with LEB128 encoding and returns a byte array,
function encodeSignedLeb128FromInt(value) {
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

// decodes an LEB128 encoded integer from an input byte array. 
const decodeSignedLeb128 = (input, startIndex) => {
	let result = 0;
	let shift = 0;
	let index = startIndex;
	while (true) {
		const byte = input[index++];
		result |= (byte & 0x7f) << shift;
		shift += 7;
		if ((0x80 & byte) === 0) {
			if (shift < 32 && (byte & 0x40) !== 0) {
				result = result | (~0 << shift);
			}
			return { result, bytesRead: index - startIndex };
		}
	}
};

/**
 * Puts a constant value onto the chunk buffer.
 * The constant value will be LEB128 encoded.
 */
function putConstOnBuffer(chunkBuffer, constValue) {
	const byteBuffer = encodeSignedLeb128FromInt(constValue);
	for (const b of byteBuffer) chunkBuffer.push(b);
}

/**
 * Puts a constant value onto the buffer, along with a const instruction to load it onto the stack.
 * The constant value will be LEB128 encoded.
 */
function putConstOnStack(chunkBuffer, constValue, constSize) {
	// wasm will only support 32-bit and 64-bit, but input size may be 8 or 16
	if (constSize === 64) chunkBuffer.push(0x42);
	else chunkBuffer.push(0x41);

	putConstOnBuffer(chunkBuffer, constValue);
}

// loads a value from memory into the WASM stack.
// requires a memory address to exist on the stack.
// +0 stack contents
function sizedLoad(buffer, size) {
	if (size === 64) {
		buffer.push(0x29); // i64.load
		buffer.push(0x02); // alignment
	} else if (size === 32) {
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

// stores a value on the WASM stack into memory.
// requires a memory address and a value to exist on the stack.
// -2 stack contents
function sizedStore(buffer, size) {
	if (size === 64) {
		buffer.push(0x37); // i64.store
		buffer.push(0x02); // alignment
	} else if (size === 32) {
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

// takes an operand, interprets it, and places it on the WASM stack.
// +1 stack contents
function operandToStack(assembler, operand, buffer) {
	if (operand.type === "imm") {
		if (operand.indirect) {
			putConstOnStack(buffer, operand.val, operand.size);
			if (!sizedLoad(buffer, operand.size)) return false;
		} else {
			putConstOnStack(buffer, operand.val, operand.size);
		}
	} else if (operand.type === "reg") {
		if (operand.indirect) {
			buffer.push(0x23); // global.get
			buffer.push(operand.val);
			
			if (operand.displace) {
				putConstOnStack(buffer, operand.displace, 32);
				buffer.push(0x6A); // i32.add
			} 
			if (!sizedLoad(buffer, operand.size)) return false;
		} else {
			buffer.push(0x23); // global.get
			buffer.push(operand.val);
			// technically illegal but used in sketchy LEA implementation
			if (operand.displace) {
				putConstOnStack(buffer, operand.displace, 32);
				buffer.push(0x6A); // i32.add
			}
		}
	} else if (operand.type === 'seg') {
		if (operand.indirect) {
			buffer.push(0x23); // global.get
			buffer.push(assembler.registers.length + operand.val);
			
			if (operand.displace) {
				putConstOnStack(buffer, operand.displace, 32);
				buffer.push(0x6A); // i32.add
			} 
			if (!sizedLoad(buffer, operand.size)) return false;
		} else {
			buffer.push(0x23); // global.get
			buffer.push(assembler.registers.length + operand.val);
		}
	} else {
		if (!assembler.operandToStackCallback(assembler, operand, buffer)) {
			console.log("Unknown operand type to be placed on stack!");
			return false;
		}
	}
	
	return true;
}

// assuming a value exists on the WASM stack, moves this value into an operand.
// -1 stack contents
function stackToOperand(assembler, operand, buffer) {
	if (operand.type === "imm") {
		if (operand.indirect) {
			// read the value into temp register
			buffer.push(0x24); // global.set
			buffer.push(assembler.registers.findIndex(x => x.name === "t1"));
			
			// set the address to write to
			putConstOnStack(buffer, operand.val, operand.size);
			
			// restore value onto stack
			buffer.push(0x23); // global.get
			buffer.push(assembler.registers.findIndex(x => x.name === "t1"));
			
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
			buffer.push(assembler.registers.findIndex(x => x.name === "t1"));
			
			// set the address to write to
			buffer.push(0x23); // global.get
			buffer.push(operand.val);
			
			if (operand.displace) {
				putConstOnStack(buffer, operand.displace, 32);
				buffer.push(0x6A); // i32.add
			} 
			
			// restore value onto stack
			buffer.push(0x23); // global.get
			buffer.push(assembler.registers.findIndex(x => x.name === "t1"));
			
			// store
			if (!sizedStore(buffer, operand.size)) return false;
		} else {
			buffer.push(0x24); // global.set
			buffer.push(operand.val);
		}
	} else if (operand.type === "seg") {
		if (operand.indirect) {
			// read the value into temp register
			buffer.push(0x24); // global.set
			buffer.push(assembler.registers.findIndex(x => x.name === "t1"));
			
			// set the address to write to
			buffer.push(0x23); // global.get
			buffer.push(assembler.registers.length + operand.val);
			
			if (operand.displace) {
				putConstOnStack(buffer, operand.displace, 32);
				buffer.push(0x6A); // i32.add
			} 
			
			// restore value onto stack
			buffer.push(0x23); // global.get
			buffer.push(assembler.registers.findIndex(x => x.name === "t1"));
			
			// store
			if (!sizedStore(buffer, operand.size)) return false;
		} else {
			buffer.push(0x24); // global.set
			buffer.push(assembler.registers.length + operand.val);
		}
	} else {
		if (!assembler.stackToOperandCallback(assembler, operand, buffer)) {
			console.log("Unknown operand type to be placed on stack!");
			return false;
		}
	}
	
	return true;
}

// processes a WASM function definition and returns a textual representation.
// this is used to help analyze the output of a chunk and confirm correctness.
// it can also help identify issues in the output (e.g. using the wrong operand types, stack issues) without needing to read the bytecode directly.
function wasmFunctionToText(buffer) {
	const stringBuffer = ["(func"];
	let index = 1, indent = 1; // index starts at 1 to skip local declaration count.
	while (index < buffer.length) {
		const opcode = buffer[index];
		index += 1;
		let currentString = "\t".repeat(indent);
		switch (opcode) {
			case 0x00: {
				currentString += "unreachable";
				break;
			}
			case 0x01: {
				currentString += "nop";
				break;
			}
			case 0x02: {
				currentString += `(block $${index}`;
				indent += 1;
				index += 1; // skip void
				break;
			}
			case 0x03: {
				currentString += `(loop $${index}`;
				indent += 1;
				index += 1; // skip void
				break;
			}
			case 0x04: {
				currentString += `(if`;
				stringBuffer.push(currentString);
				indent += 1;
				currentString = "\t".repeat(indent) + "(then";
				indent += 1;
				break;
			}
			case 0x05: {
				currentString += ")";
				stringBuffer.push(currentString);
				indent -= 1;
				currentString = "\t".repeat(indent) + `(else`;
				indent += 1;
				break;
			}
			case 0x0B: {
				indent -= 1;
				currentString = "\t".repeat(indent) + ")";
				break;
			}
			case 0x0C: {
				currentString += "br";
				const { result, bytesRead } = decodeSignedLeb128(buffer, index);
				index += bytesRead;
				currentString += ` ${result}`;
				break;
			}
			case 0x0D: {
				currentString += "br_if";
				const { result, bytesRead } = decodeSignedLeb128(buffer, index);
				index += bytesRead;
				currentString += ` ${result}`;
				break;
			}
			case 0x0F: {
				currentString += "return";
				break;
			}
			case 0x10: {
				currentString += "call";
				const { result, bytesRead } = decodeSignedLeb128(buffer, index);
				index += bytesRead;
				currentString += ` ${result}`;
				break;
			}
			case 0x11: {
				currentString += "call_indirect";
				const { result, bytesRead } = decodeSignedLeb128(buffer, index);
				index += bytesRead;
				currentString += ` ${result}`;
				break;
			}
			case 0x1A: {
				currentString += "drop";
				break;
			}
			case 0x1B: {
				currentString += "select";
				break;
			}
			case 0x20: {
				currentString += "local.get";
				const { result, bytesRead } = decodeSignedLeb128(buffer, index);
				index += bytesRead;
				currentString += ` ${result}`;
				break;
			}
			case 0x21: {
				currentString += "local.set";
				const { result, bytesRead } = decodeSignedLeb128(buffer, index);
				index += bytesRead;
				currentString += ` ${result}`;
				break;
			}
			case 0x22: {
				currentString += "local.tee";
				const { result, bytesRead } = decodeSignedLeb128(buffer, index);
				index += bytesRead;
				currentString += ` ${result}`;
				break;
			}
			case 0x23: {
				currentString += "global.get";
				const { result, bytesRead } = decodeSignedLeb128(buffer, index);
				index += bytesRead;
				currentString += ` ${result}`;
				break;
			}
			case 0x24: {
				currentString += "global.set";
				const { result, bytesRead } = decodeSignedLeb128(buffer, index);
				index += bytesRead;
				currentString += ` ${result}`;
				break;
			}
			case 0x28: {
				currentString += "i32.load";
				const { result: resultAlign, bytesRead: bytesReadAlign } = decodeSignedLeb128(buffer, index);
				index += bytesReadAlign;
				currentString += ` align=${resultAlign}`;

				const { result: resultOffset, bytesRead: bytesReadOffset } = decodeSignedLeb128(buffer, index);
				index += bytesReadOffset;
				currentString += ` offset=${resultOffset}`;
				break;
			}
			case 0x29: {
				currentString += "i64.load";
				const { result: resultAlign, bytesRead: bytesReadAlign } = decodeSignedLeb128(buffer, index);
				index += bytesReadAlign;
				currentString += ` align=${resultAlign}`;

				const { result: resultOffset, bytesRead: bytesReadOffset } = decodeSignedLeb128(buffer, index);
				index += bytesReadOffset;
				currentString += ` offset=${resultOffset}`;
				break;
			}
			case 0x2A: {
				currentString += "f32.load";
				const { result: resultAlign, bytesRead: bytesReadAlign } = decodeSignedLeb128(buffer, index);
				index += bytesReadAlign;
				currentString += ` align=${resultAlign}`;

				const { result: resultOffset, bytesRead: bytesReadOffset } = decodeSignedLeb128(buffer, index);
				index += bytesReadOffset;
				currentString += ` offset=${resultOffset}`;
				break;
			}
			case 0x2B: {
				currentString += "f64.load";
				const { result: resultAlign, bytesRead: bytesReadAlign } = decodeSignedLeb128(buffer, index);
				index += bytesReadAlign;
				currentString += ` align=${resultAlign}`;

				const { result: resultOffset, bytesRead: bytesReadOffset } = decodeSignedLeb128(buffer, index);
				index += bytesReadOffset;
				currentString += ` offset=${resultOffset}`;
				break;
			}
			case 0x2C: {
				currentString += "i32.load8_s";
				const { result: resultAlign, bytesRead: bytesReadAlign } = decodeSignedLeb128(buffer, index);
				index += bytesReadAlign;
				currentString += ` align=${resultAlign}`;

				const { result: resultOffset, bytesRead: bytesReadOffset } = decodeSignedLeb128(buffer, index);
				index += bytesReadOffset;
				currentString += ` offset=${resultOffset}`;
				break;
			}
			case 0x2D: {
				currentString += "i32.load8_u";
				const { result: resultAlign, bytesRead: bytesReadAlign } = decodeSignedLeb128(buffer, index);
				index += bytesReadAlign;
				currentString += ` align=${resultAlign}`;

				const { result: resultOffset, bytesRead: bytesReadOffset } = decodeSignedLeb128(buffer, index);
				index += bytesReadOffset;
				currentString += ` offset=${resultOffset}`;
				break;
			}
			case 0x2E: {
				currentString += "i32.load16_s";
				const { result: resultAlign, bytesRead: bytesReadAlign } = decodeSignedLeb128(buffer, index);
				index += bytesReadAlign;
				currentString += ` align=${resultAlign}`;

				const { result: resultOffset, bytesRead: bytesReadOffset } = decodeSignedLeb128(buffer, index);
				index += bytesReadOffset;
				currentString += ` offset=${resultOffset}`;
				break;
			}
			case 0x2F: {
				currentString += "i32.load16_u";
				const { result: resultAlign, bytesRead: bytesReadAlign } = decodeSignedLeb128(buffer, index);
				index += bytesReadAlign;
				currentString += ` align=${resultAlign}`;

				const { result: resultOffset, bytesRead: bytesReadOffset } = decodeSignedLeb128(buffer, index);
				index += bytesReadOffset;
				currentString += ` offset=${resultOffset}`;
				break;
			}
			case 0x30: {
				currentString += "i64.load8_s";
				const { result: resultAlign, bytesRead: bytesReadAlign } = decodeSignedLeb128(buffer, index);
				index += bytesReadAlign;
				currentString += ` align=${resultAlign}`;

				const { result: resultOffset, bytesRead: bytesReadOffset } = decodeSignedLeb128(buffer, index);
				index += bytesReadOffset;
				currentString += ` offset=${resultOffset}`;
				break;
			}
			case 0x31: {
				currentString += "i64.load8_u";
				const { result: resultAlign, bytesRead: bytesReadAlign } = decodeSignedLeb128(buffer, index);
				index += bytesReadAlign;
				currentString += ` align=${resultAlign}`;

				const { result: resultOffset, bytesRead: bytesReadOffset } = decodeSignedLeb128(buffer, index);
				index += bytesReadOffset;
				currentString += ` offset=${resultOffset}`;
				break;
			}
			case 0x32: {
				currentString += "i64.load16_s";
				const { result: resultAlign, bytesRead: bytesReadAlign } = decodeSignedLeb128(buffer, index);
				index += bytesReadAlign;
				currentString += ` align=${resultAlign}`;

				const { result: resultOffset, bytesRead: bytesReadOffset } = decodeSignedLeb128(buffer, index);
				index += bytesReadOffset;
				currentString += ` offset=${resultOffset}`;
				break;
			}
			case 0x33: {
				currentString += "i64.load16_u";
				const { result: resultAlign, bytesRead: bytesReadAlign } = decodeSignedLeb128(buffer, index);
				index += bytesReadAlign;
				currentString += ` align=${resultAlign}`;

				const { result: resultOffset, bytesRead: bytesReadOffset } = decodeSignedLeb128(buffer, index);
				index += bytesReadOffset;
				currentString += ` offset=${resultOffset}`;
				break;
			}
			case 0x34: {
				currentString += "i64.load32_s";
				const { result: resultAlign, bytesRead: bytesReadAlign } = decodeSignedLeb128(buffer, index);
				index += bytesReadAlign;
				currentString += ` align=${resultAlign}`;

				const { result: resultOffset, bytesRead: bytesReadOffset } = decodeSignedLeb128(buffer, index);
				index += bytesReadOffset;
				currentString += ` offset=${resultOffset}`;
				break;
			}
			case 0x35: {
				currentString += "i64.load32_u";
				const { result: resultAlign, bytesRead: bytesReadAlign } = decodeSignedLeb128(buffer, index);
				index += bytesReadAlign;
				currentString += ` align=${resultAlign}`;

				const { result: resultOffset, bytesRead: bytesReadOffset } = decodeSignedLeb128(buffer, index);
				index += bytesReadOffset;
				currentString += ` offset=${resultOffset}`;
				break;
			}
			case 0x36: {
				currentString += "i32.store";
				const { result: resultAlign, bytesRead: bytesReadAlign } = decodeSignedLeb128(buffer, index);
				index += bytesReadAlign;
				currentString += ` align=${resultAlign}`;

				const { result: resultOffset, bytesRead: bytesReadOffset } = decodeSignedLeb128(buffer, index);
				index += bytesReadOffset;
				currentString += ` offset=${resultOffset}`;
				break;
			}
			case 0x37: {
				currentString += "i64.store";
				const { result: resultAlign, bytesRead: bytesReadAlign } = decodeSignedLeb128(buffer, index);
				index += bytesReadAlign;
				currentString += ` align=${resultAlign}`;

				const { result: resultOffset, bytesRead: bytesReadOffset } = decodeSignedLeb128(buffer, index);
				index += bytesReadOffset;
				currentString += ` offset=${resultOffset}`;
				break;
			}
			case 0x38: {
				currentString += "f32.store";
				const { result: resultAlign, bytesRead: bytesReadAlign } = decodeSignedLeb128(buffer, index);
				index += bytesReadAlign;
				currentString += ` align=${resultAlign}`;

				const { result: resultOffset, bytesRead: bytesReadOffset } = decodeSignedLeb128(buffer, index);
				index += bytesReadOffset;
				currentString += ` offset=${resultOffset}`;
				break;
			}
			case 0x39: {
				currentString += "f64.store";
				const { result: resultAlign, bytesRead: bytesReadAlign } = decodeSignedLeb128(buffer, index);
				index += bytesReadAlign;
				currentString += ` align=${resultAlign}`;

				const { result: resultOffset, bytesRead: bytesReadOffset } = decodeSignedLeb128(buffer, index);
				index += bytesReadOffset;
				currentString += ` offset=${resultOffset}`;
				break;
			}
			case 0x3A: {
				currentString += "i32.store8";
				const { result: resultAlign, bytesRead: bytesReadAlign } = decodeSignedLeb128(buffer, index);
				index += bytesReadAlign;
				currentString += ` align=${resultAlign}`;

				const { result: resultOffset, bytesRead: bytesReadOffset } = decodeSignedLeb128(buffer, index);
				index += bytesReadOffset;
				currentString += ` offset=${resultOffset}`;
				break;
			}
			case 0x3B: {
				currentString += "i32.store16";
				const { result: resultAlign, bytesRead: bytesReadAlign } = decodeSignedLeb128(buffer, index);
				index += bytesReadAlign;
				currentString += ` align=${resultAlign}`;

				const { result: resultOffset, bytesRead: bytesReadOffset } = decodeSignedLeb128(buffer, index);
				index += bytesReadOffset;
				currentString += ` offset=${resultOffset}`;
				break;
			}
			case 0x3C: {
				currentString += "i64.store8";
				const { result: resultAlign, bytesRead: bytesReadAlign } = decodeSignedLeb128(buffer, index);
				index += bytesReadAlign;
				currentString += ` align=${resultAlign}`;

				const { result: resultOffset, bytesRead: bytesReadOffset } = decodeSignedLeb128(buffer, index);
				index += bytesReadOffset;
				currentString += ` offset=${resultOffset}`;
				break;
			}
			case 0x3D: {
				currentString += "i64.store16";
				const { result: resultAlign, bytesRead: bytesReadAlign } = decodeSignedLeb128(buffer, index);
				index += bytesReadAlign;
				currentString += ` align=${resultAlign}`;

				const { result: resultOffset, bytesRead: bytesReadOffset } = decodeSignedLeb128(buffer, index);
				index += bytesReadOffset;
				currentString += ` offset=${resultOffset}`;
				break;
			}
			case 0x3E: {
				currentString += "i64.store32";
				const { result: resultAlign, bytesRead: bytesReadAlign } = decodeSignedLeb128(buffer, index);
				index += bytesReadAlign;
				currentString += ` align=${resultAlign}`;

				const { result: resultOffset, bytesRead: bytesReadOffset } = decodeSignedLeb128(buffer, index);
				index += bytesReadOffset;
				currentString += ` offset=${resultOffset}`;
				break;
			}
			case 0x3F: {
				currentString += "memory.size";
				break;
			}
			case 0x40: {
				currentString += "memory.grow";
				break;
			}
			case 0x41: {
				currentString += "i32.const";
				const { result, bytesRead } = decodeSignedLeb128(buffer, index);
				index += bytesRead;
				currentString += ` ${result}`;
				break;
			}
			case 0x42: {
				currentString += "i64.const";
				const { result, bytesRead } = decodeSignedLeb128(buffer, index);
				index += bytesRead;
				currentString += ` ${result}`;
				break;
			}
			case 0x43: {
				currentString += "f32.const";
				const { result, bytesRead } = decodeSignedLeb128(buffer, index);
				index += bytesRead;
				currentString += ` ${result}`;
				break;
			}
			case 0x44: {
				currentString += "f64.const";
				const { result, bytesRead } = decodeSignedLeb128(buffer, index);
				index += bytesRead;
				currentString += ` ${result}`;
				break;
			}
			case 0x45: {
				currentString += "i32.eqz";
				break;
			}
			case 0x46: {
				currentString += "i32.eq";
				break;
			}
			case 0x47: {
				currentString += "i32.ne";
				break;
			}
			case 0x48: {
				currentString += "i32.lt_s";
				break;
			}
			case 0x49: {
				currentString += "i32.lt_u";
				break;
			}
			case 0x4A: {
				currentString += "i32.gt_s";
				break;
			}
			case 0x4B: {
				currentString += "i32.gt_u";
				break;
			}
			case 0x4C: {
				currentString += "i32.le_s";
				break;
			}
			case 0x4D: {
				currentString += "i32.le_u";
				break;
			}
			case 0x4E: {
				currentString += "i32.ge_s";
				break;
			}
			case 0x4F: {
				currentString += "i32.ge_u";
				break;
			}
			case 0x50: {
				currentString += "i64.eqz";
				break;
			}
			case 0x51: {
				currentString += "i64.eq";
				break;
			}
			case 0x52: {
				currentString += "i64.ne";
				break;
			}
			case 0x53: {
				currentString += "i64.lt_s";
				break;
			}
			case 0x54: {
				currentString += "i64.lt_u";
				break;
			}
			case 0x55: {
				currentString += "i64.gt_s";
				break;
			}
			case 0x56: {
				currentString += "i64.gt_u";
				break;
			}
			case 0x57: {
				currentString += "i64.le_s";
				break;
			}
			case 0x58: {
				currentString += "i64.le_u";
				break;
			}
			case 0x59: {
				currentString += "i64.ge_s";
				break;
			}
			case 0x5A: {
				currentString += "i64.ge_u";
				break;
			}
			case 0x5B: {
				currentString += "f32.eq";
				break;
			}
			case 0x5C: {
				currentString += "f32.ne";
				break;
			}
			case 0x5D: {
				currentString += "f32.lt";
				break;
			}
			case 0x5E: {
				currentString += "f32.gt";
				break;
			}
			case 0x5F: {
				currentString += "f32.le";
				break;
			}
			case 0x60: {
				currentString += "f32.ge";
				break;
			}
			case 0x61: {
				currentString += "f64.eq";
				break;
			}
			case 0x62: {
				currentString += "f64.ne";
				break;
			}
			case 0x63: {
				currentString += "f64.lt";
				break;
			}
			case 0x64: {
				currentString += "f64.gt";
				break;
			}
			case 0x65: {
				currentString += "f64.le";
				break;
			}
			case 0x66: {
				currentString += "f64.ge";
				break;
			}
			case 0x67: {
				currentString += "i32.clz";
				break;
			}
			case 0x68: {
				currentString += "i32.ctz";
				break;
			}
			case 0x69: {
				currentString += "i32.popcnt";
				break;
			}
			case 0x6A: {
				currentString += "i32.add";
				break;
			}
			case 0x6B: {
				currentString += "i32.sub";
				break;
			}
			case 0x6C: {
				currentString += "i32.mul";
				break;
			}
			case 0x6D: {
				currentString += "i32.div_s";
				break;
			}
			case 0x6E: {
				currentString += "i32.div_u";
				break;
			}
			case 0x6F: {
				currentString += "i32.rem_s";
				break;
			}
			case 0x70: {
				currentString += "i32.rem_u";
				break;
			}
			case 0x71: {
				currentString += "i32.and";
				break;
			}
			case 0x72: {
				currentString += "i32.or";
				break;
			}
			case 0x73: {
				currentString += "i32.xor";
				break;
			}
			case 0x74: {
				currentString += "i32.shl";
				break;
			}
			case 0x75: {
				currentString += "i32.shr_s";
				break;
			}
			case 0x76: {
				currentString += "i32.shr_u";
				break;
			}
			case 0x77: {
				currentString += "i32.rotl";
				break;
			}
			case 0x78: {
				currentString += "i32.rotr";
				break;
			}
			case 0x79: {
				currentString += "i64.clz";
				break;
			}
			case 0x7A: {
				currentString += "i64.ctz";
				break;
			}
			case 0x7B: {
				currentString += "i64.popcnt";
				break;
			}
			case 0x7C: {
				currentString += "i64.add";
				break;
			}
			case 0x7D: {
				currentString += "i64.sub";
				break;
			}
			case 0x7E: {
				currentString += "i64.mul";
				break;
			}
			case 0x7F: {
				currentString += "i64.div_s";
				break;
			}
			case 0x80: {
				currentString += "i64.div_u";
				break;
			}
			case 0x81: {
				currentString += "i64.rem_s";
				break;
			}
			case 0x82: {
				currentString += "i64.rem_u";
				break;
			}
			case 0x83: {
				currentString += "i64.and";
				break;
			}
			case 0x84: {
				currentString += "i64.or";
				break;
			}
			case 0x85: {
				currentString += "i64.xor";
				break;
			}
			case 0x86: {
				currentString += "i64.shl";
				break;
			}
			case 0x87: {
				currentString += "i64.shr_s";
				break;
			}
			case 0x88: {
				currentString += "i64.shr_u";
				break;
			}
			case 0x89: {
				currentString += "i64.rotl";
				break;
			}
			case 0x8A: {
				currentString += "i64.rotr";
				break;
			}
			case 0x8B: {
				currentString += "f32.abs";
				break;
			}
			case 0x8C: {
				currentString += "f32.neg";
				break;
			}
			case 0x8D: {
				currentString += "f32.ceil";
				break;
			}
			case 0x8E: {
				currentString += "f32.floor";
				break;
			}
			case 0x8F: {
				currentString += "f32.trunc";
				break;
			}
			case 0x90: {
				currentString += "f32.nearest";
				break;
			}
			case 0x91: {
				currentString += "f32.sqrt";
				break;
			}
			case 0x92: {
				currentString += "f32.add";
				break;
			}
			case 0x93: {
				currentString += "f32.sub";
				break;
			}
			case 0x94: {
				currentString += "f32.mul";
				break;
			}
			case 0x95: {
				currentString += "f32.div";
				break;
			}
			case 0x96: {
				currentString += "f32.min";
				break;
			}
			case 0x97: {
				currentString += "f32.max";
				break;
			}
			case 0x98: {
				currentString += "f32.copysign";
				break;
			}
			case 0x99: {
				currentString += "f64.abs";
				break;
			}
			case 0x9A: {
				currentString += "f64.neg";
				break;
			}
			case 0x9B: {
				currentString += "f64.ceil";
				break;
			}
			case 0x9C: {
				currentString += "f64.floor";
				break;
			}
			case 0x9D: {
				currentString += "f64.trunc";
				break;
			}
			case 0x9E: {
				currentString += "f64.nearest";
				break;
			}
			case 0x9F: {
				currentString += "f64.sqrt";
				break;
			}
			case 0xA0: {
				currentString += "f64.add";
				break;
			}
			case 0xA1: {
				currentString += "f64.sub";
				break;
			}
			case 0xA2: {
				currentString += "f64.mul";
				break;
			}
			case 0xA3: {
				currentString += "f64.div";
				break;
			}
			case 0xA4: {
				currentString += "f64.min";
				break;
			}
			case 0xA5: {
				currentString += "f64.max";
				break;
			}
			case 0xA6: {
				currentString += "f64.copysign";
				break;
			}
			case 0xA7: {
				currentString += "i32.wrap_i64";
				break;
			}
			case 0xA8: {
				currentString += "i32.trunc_f32_s";
				break;
			}
			case 0xA9: {
				currentString += "i32.trunc_f32_u";
				break;
			}
			case 0xAA: {
				currentString += "i32.trunc_f64_s";
				break;
			}
			case 0xAB: {
				currentString += "i32.trunc_f64_u";
				break;
			}
			case 0xAC: {
				currentString += "i64.extend_i32_s";
				break;
			}
			case 0xAD: {
				currentString += "i64.extend_i32_u";
				break;
			}
			case 0xAE: {
				currentString += "i64.trunc_f32_s";
				break;
			}
			case 0xAF: {
				currentString += "i64.trunc_f32_u";
				break;
			}
			case 0xB0: {
				currentString += "i64.trunc_f64_s";
				break;
			}
			case 0xB1: {
				currentString += "i64.trunc_f64_u";
				break;
			}
			case 0xB2: {
				currentString += "f32.convert_i32_s";
				break;
			}
			case 0xB3: {
				currentString += "f32.convert_i32_u";
				break;
			}
			case 0xB4: {
				currentString += "f32.convert_i64_s";
				break;
			}
			case 0xB5: {
				currentString += "f32.convert_i64_u";
				break;
			}
			case 0xB6: {
				currentString += "f32.demote_f64";
				break;
			}
			case 0xB7: {
				currentString += "f64.convert_i32_s";
				break;
			}
			case 0xB8: {
				currentString += "f64.convert_i32_u";
				break;
			}
			case 0xB9: {
				currentString += "f64.convert_i64_s";
				break;
			}
			case 0xBA: {
				currentString += "f64.convert_i64_u";
				break;
			}
			case 0xBB: {
				currentString += "f64.promote_f32";
				break;
			}
			case 0xBC: {
				currentString += "i32.reinterpret_f32";
				break;
			}
			case 0xBD: {
				currentString += "i64.reinterpret_f64";
				break;
			}
			case 0xBE: {
				currentString += "f32.reinterpret_i32";
				break;
			}
			case 0xBF: {
				currentString += "f64.reinterpret_i64";
				break;
			}
			default:
				console.log(`Failed to convert WASM chunk function body to text, unknown opcode ${opcode}.`);
				return false;
		}
		stringBuffer.push(currentString);
	}
	stringBuffer.push(")");
	return stringBuffer.join("\n");
}

module.exports = {
	putConstOnBuffer,
	putConstOnStack,
	sizedLoad,
	sizedStore,
    operandToStack,
    stackToOperand,
	wasmFunctionToText
};