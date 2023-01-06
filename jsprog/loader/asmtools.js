// puts a const onto the buffer by bytes
// consts are encoded with signed LEB encoding
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

module.exports = {
	putConstOnBuffer,
	putConstOnStack,
	sizedLoad,
	sizedStore,
    operandToStack,
    stackToOperand
};