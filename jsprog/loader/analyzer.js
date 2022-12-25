const {
	Instruction,
	Chunk
} = require('./structs.js');
const {
	conditionalJumpOps
} = require('./utils.js');	

const prefixOps = [0xF0, 0xF2, 0xF3, 0x66, 0x67, 0x26, 0x2E, 0x36, 0x3E, 0x64, 0x65];

const OPCODE_EXTENSION = 0x0F;

const ReadModRM = (buf, addr) => {
	const b = buf.readUInt8(addr);
	
	// mod = 2 bits, determines addressing mode
	// reg = 3 bits, determines source or destination register
	// rm  = 3 bits, determines one additional operand (second in 2-op, first in 1-op)
	const mod = (b & 0xC0) >> 6;
	const reg = (b & 0x38) >> 3;
	const rm  = b & 0x07;
	
	return { mod, reg, rm };
};

const ApplyModRM = (buf, addr, mod, rm, rs) => {
	const operands = [];
	let bytesRead = 0;
	const registerSize = rs || 32;
	if (mod === 0x00) {
		// operation depends on R/M
		if (rm === 0x04) {
			// SIB
			const sib = buf.readInt8(addr++);
			bytesRead += 1;
			
			const scale = (sib & 0xC0) >> 6;
			const index = (sib & 0x38) >> 3;
			const base  = sib & 0x07;

			if (base === 0x05) {
				// displacement-only -- is this always 32-bit?
				operands.push({
					type: 'sib',
					index,
					displace: buf.readInt32LE(addr),
					scale: Math.pow(2, scale),
					indirect: true,
					size: registerSize
				});
				bytesRead += 4;
			} else {
				operands.push({
					type: 'sib',
					index,
					base,
					scale: Math.pow(2, scale),
					indirect: true,
					size: registerSize
				});
			}
		} else if (rm === 0x05) {
			// displacement only
			operands.push({
				type: 'imm',
				val: buf.readInt32LE(addr),
				indirect: true,
				size: 32
			});
			bytesRead += 4;
		} else {
			// register indirect (ptr mode)
			operands.push({
				type: 'reg',
				val: rm,
				indirect: true,
				size: registerSize
			});
		}
	} else if (mod === 0x01) {
		// one-byte signed displacement, R/M is target register
		if (rm === 0x04) {
			// SIB
			const sib = buf.readInt8(addr++);
			bytesRead += 1;

			const scale = (sib & 0xC0) >> 6;
			const index = (sib & 0x38) >> 3;
			const base  = sib & 0x07;
			operands.push({
				type: 'sib',
				index,
				base,
				scale: Math.pow(2, scale),
				displace: buf.readInt8(addr),
				indirect: true,
				size: registerSize
			});
			bytesRead += 1;
		} else {
			operands.push({
				type: 'reg',
				val: rm,
				displace: buf.readInt8(addr),
				indirect: true,
				size: registerSize
			});
			bytesRead += 1;
		}
	} else if (mod === 0x02) {
		// four-byte signed displacement, R/M is target register
		if (rm === 0x04) {
			// SIB
			const sib = buf.readInt8(addr++);
			bytesRead += 1;
			
			const scale = (sib & 0xC0) >> 6;
			const index = (sib & 0x38) >> 3;
			const base  = sib & 0x07;
			operands.push({
				type: 'sib',
				index,
				base,
				scale: Math.pow(2, scale),
				displace: buf.readInt32LE(addr),
				indirect: true,
				size: registerSize
			});
			bytesRead += 4;
		} else {
			operands.push({
				type: 'reg',
				val: rm,
				displace: buf.readInt32LE(addr),
				indirect: true,
				size: registerSize
			});
			bytesRead += 4;
		}
	} else if (mod === 0x03) {
		// register addressing, R/M is target register
		operands.push({
			type: 'reg',
			val: rm,
			size: registerSize
		});
	}

	return {
		operands,
		bytesRead
	};
};

const ReadSizedImmediate = (buf, addr, opChangeSize) => {
	const operands = [];
	let bytesRead = 0;
	if (!opChangeSize) {
		operands.push({
			type: 'imm',
			val: buf.readInt32LE(addr),
			size: 32
		});
		bytesRead += 4;
	} else {
		operands.push({
			type: 'imm',
			val: buf.readInt16LE(addr),
			size: 16
		});
		bytesRead += 2;
	}

	return {
		operands,
		bytesRead
	};
};

const ProcessOpcode = (opcode, opChangeSize, buf, addr) => {
	const operandSet = [];
	let operandName = "", bytesRead = 0;
	
	if (opcode === 0x00) {
		// ADD r/m8, r8
		operandName = "ADD";

		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: 8
		});
	} else if (opcode === 0x01) {
		// ADD r/m16, r16 | ADD r/m32, r32
		operandName = "ADD";

		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: opChangeSize ? 16 : 32
		});
	} else if (opcode === 0x02) {
		// ADD r8, r/m8
		operandName = "ADD";

		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: 8
		});

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x03) {
		// ADD r16, r/m16 | ADD r32, r/m32
		operandName = "ADD";

		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: opChangeSize ? 16 : 32
		});

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x04) {
		// ADD AL, imm8
		operandName = "ADD";
		operandSet.push({
			type: 'reg',
			val: 0x00
		});
		operandSet.push({
			type: 'imm',
			val: buf.readInt8(addr)
		});
		bytesRead++;
	} else if (opcode === 0x05) {
		// ADD AX, imm16 | ADD EAX, imm32
		operandName = "ADD";
		operandSet.push({
			type: 'reg',
			val: 0x00,
			size: 8
		});

		const sized = ReadSizedImmediate(buf, addr, opChangeSize);
		bytesRead += sized.bytesRead;
		operandSet.push(...sized.operands);
	} else if (opcode === 0x08) {
		// OR r/m8, r8
		operandName = "OR";

		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: 8
		});
	} else if (opcode === 0x09) {
		// OR r/m16, r16 | OR r/m32, r32
		operandName = "OR";

		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: opChangeSize ? 16 : 32
		});
	} else if (opcode === 0x0A) {
		// OR r8, r/m8
		operandName = "OR";

		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: 8
		});

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x0B) {
		// OR r16, r/m16 | OR r32, r/m32
		operandName = "OR";

		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: opChangeSize ? 16 : 32
		});

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x0C) {
		// OR AL, imm8
		operandName = "OR";
		operandSet.push({
			type: 'reg',
			val: 0x00
		});
		operandSet.push({
			type: 'imm',
			val: buf.readInt8(addr)
		});
		bytesRead++;
	} else if (opcode === 0x0D) {
		// OR AX, imm16 | OR EAX, imm32
		operandName = "OR";
		operandSet.push({
			type: 'reg',
			val: 0x00,
			size: 8
		});

		const sized = ReadSizedImmediate(buf, addr, opChangeSize);
		bytesRead += sized.bytesRead;
		operandSet.push(...sized.operands);
	} else if (opcode === 0x18) {
		// SBB r/m8, r8
		operandName = "SBB";

		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: 8
		});
	} else if (opcode === 0x19) {
		// SBB r/m16, r16 | SBB r/m32, r32
		operandName = "SBB";

		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: opChangeSize ? 16 : 32
		});
	} else if (opcode === 0x1A) {
		// SBB r8, r/m8
		operandName = "SBB";

		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: 8
		});

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x1B) {
		// SBB r16, r/m16 | SBB r32, r/m32
		operandName = "SBB";

		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: opChangeSize ? 16 : 32
		});

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x1C) {
		// SBB AL, imm8
		operandName = "SBB";
		operandSet.push({
			type: 'reg',
			val: 0x00
		});
		operandSet.push({
			type: 'imm',
			val: buf.readInt8(addr)
		});
		bytesRead++;
	} else if (opcode === 0x1D) {
		// SBB AX, imm16 | SBB EAX, imm32
		operandName = "SBB";
		operandSet.push({
			type: 'reg',
			val: 0x00,
			size: 8
		});

		const sized = ReadSizedImmediate(buf, addr, opChangeSize);
		bytesRead += sized.bytesRead;
		operandSet.push(...sized.operands);
	} else if (opcode === 0x20) {
		// AND r/m8, r8
		operandName = "AND";
		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: 8
		});
	} else if (opcode === 0x21) {
		// AND r/m16, r16 | AND r/m32, r32
		operandName = "AND";
		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: opChangeSize ? 16 : 32
		});
	} else if (opcode === 0x22) {
		// AND r8, r/m8
		operandName = "AND";
		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: 8
		});

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x23) {
		// AND r16, r/m16 | AND r32, r/m32
		operandName = "AND";
		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: opChangeSize ? 16 : 32
		});

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
	} else if (opcode === 0x24) {
		// AND AL, imm8
		operandName = "AND";
		operandSet.push({
			type: 'reg',
			val: 0x00
		});
		operandSet.push({
			type: 'imm',
			val: buf.readInt8(addr)
		});
		bytesRead++;
	} else if (opcode === 0x25) {
		// AND AX, imm16 | AND EAX, imm32
		operandName = "AND";
		operandSet.push({
			type: 'reg',
			val: 0x00,
			size: 8
		});

		const sized = ReadSizedImmediate(buf, addr, opChangeSize);
		bytesRead += sized.bytesRead;
		operandSet.push(...sized.operands);
	} else if (opcode === 0x28) {
		// SUB r/m8, r8
		operandName = "SUB";
		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: 8
		});
	} else if (opcode === 0x29) {
		// SUB r/m16, r16 | SUB r/m32, r32
		operandName = "SUB";
		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: opChangeSize ? 16 : 32
		});
	} else if (opcode === 0x2A) {
		// SUB r8, r/m8
		operandName = "SUB";
		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: 8
		});

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x2B) {
		// SUB r16, r/m16 | SUB r32, r/m32
		operandName = "SUB";
		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: opChangeSize ? 16 : 32
		});

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x2C) {
		// SUB AL, imm8
		operandName = "SUB";
		operandSet.push({
			type: 'reg',
			val: 0x00
		});
		operandSet.push({
			type: 'imm',
			val: buf.readInt8(addr)
		});
		bytesRead++;
	} else if (opcode === 0x2D) {
		// SUB AX, imm16 | SUB EAX, imm32
		operandName = "SUB";
		operandSet.push({
			type: 'reg',
			val: 0x00,
			size: 8
		});

		const sized = ReadSizedImmediate(buf, addr, opChangeSize);
		bytesRead += sized.bytesRead;
		operandSet.push(...sized.operands);
	} else if (opcode === 0x30) {
		// XOR r/m8, r8
		operandName = "XOR";
		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: 8
		});
	} else if (opcode === 0x31) {
		// XOR r/m16, r16 | XOR r/m32, r32
		operandName = "XOR";
		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: opChangeSize ? 16 : 32
		});
	} else if (opcode === 0x32) {
		// XOR r8, r/m8
		operandName = "XOR";
		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: 8
		});

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x33) {
		// XOR r16, r/m16 | XOR r32, r/m32
		operandName = "XOR";
		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: opChangeSize ? 16 : 32
		});

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x34) {
		// XOR AL, imm8
		operandName = "XOR";

		operandSet.push({
			type: 'reg',
			val: 0x00,
			size: 8
		});
		operandSet.push({
			type: 'reg',
			val: buf.readInt8(addr),
			size: 8
		});
		bytesRead++;
	} else if (opcode === 0x35) {
		// XOR AX, imm16 | XOR EAX, imm32
		operandName = "XOR";

		operandSet.push({
			type: 'reg',
			val: 0x00,
			size: opChangeSize ? 16 : 32
		});
		
		const sized = ReadSizedImmediate(buf, addr, opChangeSize);
		bytesRead += sized.bytesRead;
		operandSet.push(...sized.operands);
	} else if (opcode === 0x38) {
		// CMP r/m8, r8
		operandName = "CMP";
		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: 8
		});
	} else if (opcode === 0x39) {
		// CMP r/m16, r16 | CMP r/m32, r32
		operandName = "CMP";
		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: opChangeSize ? 16 : 32
		});
	} else if (opcode === 0x3A) {
		// CMP r8, r/m8
		operandName = "CMP";
		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: 8
		});

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x3B) {
		// CMP r16, r/m16 | CMP r32, r/m32
		operandName = "CMP";
		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: opChangeSize ? 16 : 32
		});

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x3C) {
		// CMP AL, imm8
		operandName = "CMP";

		operandSet.push({
			type: 'reg',
			val: 0x00,
			size: 8
		});
		operandSet.push({
			type: 'reg',
			val: buf.readInt8(addr),
			size: 8
		});
		bytesRead++;
	} else if (opcode === 0x3D) {
		// CMP AX, imm16 | CMP EAX, imm32
		operandName = "CMP";

		operandSet.push({
			type: 'reg',
			val: 0x00,
			size: opChangeSize ? 16 : 32
		});
		
		const sized = ReadSizedImmediate(buf, addr, opChangeSize);
		bytesRead += sized.bytesRead;
		operandSet.push(...sized.operands);
	} else if (opcode >= 0x40 && opcode <= 0x47) {
		// INC r32 - register used is based on register code.
		operandName = "INC";
		operandSet.push({
			type: 'reg',
			val: opcode - 0x40,
			size: opChangeSize ? 16 : 32
		});
	} else if (opcode >= 0x48 && opcode <= 0x4F) {
		// DEC r32 - register used is based on register code.
		operandName = "DEC";
		operandSet.push({
			type: 'reg',
			val: opcode - 0x48,
			size: opChangeSize ? 16 : 32
		});
	} else if (opcode >= 0x50 && opcode <= 0x57) {
		// PUSH r32 - register used is based on register code.
		operandName = "PUSH";
		operandSet.push({
			type: 'reg',
			val: opcode - 0x50,
			size: opChangeSize ? 16 : 32
		});
	} else if (opcode >= 0x58 && opcode <= 0x5F) {
		// POP r32 - register used is based on register code.
		operandName = "POP";
		operandSet.push({
			type: 'reg',
			val: opcode - 0x58,
			size: opChangeSize ? 16 : 32
		});
	} else if (opcode === 0x60) {
		// PUSHAD
		operandName = "PUSHAD";
	} else if (opcode === 0x61) {
		// POPAD
		operandName = "POPAD";
	} else if (opcode === 0x68) {
		// PUSH imm16 | PUSH imm32
		operandName = "PUSH";
		const sized = ReadSizedImmediate(buf, addr, opChangeSize);
		bytesRead += sized.bytesRead;
		operandSet.push(...sized.operands);
	} else if (opcode === 0x69) {
		// IMUL r16, r/m16, imm16 | IMUL r32, r/m32, imm32 | IMUL r16, imm16 | IMUL r32, imm32
		operandName = "IMUL";

		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: opChangeSize ? 16 : 32
		});

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
		addr += processed.bytesRead;

		const sized = ReadSizedImmediate(buf, addr, opChangeSize);
		bytesRead += sized.bytesRead;
		operandSet.push(...sized.operands);
	} else if (opcode === 0x6A) {
		// PUSH imm8
		operandName = "PUSH";
		operandSet.push({
			type: 'imm',
			val: buf.readInt8(addr),
			size: 8
		});
		bytesRead++;
	} else if (opcode === 0x6B) {
		// IMUL r16, r/m16, imm8 | IMUL r32, r/m32, imm8 | IMUL r16, imm8 | IMUL r32, imm8
		operandName = "IMUL";
		
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: opChangeSize ? 16 : 32
		});

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
		addr += processed.bytesRead;

		operandSet.push({
			type: 'imm',
			val: buf.readInt8(addr),
			size: 8
		});
		bytesRead++;
	} else if (opcode === 0x70) {
		// JO rel8
		operandName = "JO";
		operandSet.push({
			type: 'imm',
			val: buf.readInt8(addr),
			size: 8
		});
		bytesRead++;
	} else if (opcode === 0x71) {
		// JNO rel8
		operandName = "JNO";
		operandSet.push({
			type: 'imm',
			val: buf.readInt8(addr),
			size: 8
		});
		bytesRead++;
	} else if (opcode === 0x72) {
		// JB rel8
		operandName = "JB";
		operandSet.push({
			type: 'imm',
			val: buf.readInt8(addr),
			size: 8
		});
		bytesRead++;
	} else if (opcode === 0x73) {
		// JAE rel8
		operandName = "JAE";
		operandSet.push({
			type: 'imm',
			val: buf.readInt8(addr),
			size: 8
		});
		bytesRead++;
	} else if (opcode === 0x74) {
		// JE rel8
		operandName = "JE";
		operandSet.push({
			type: 'imm',
			val: buf.readInt8(addr),
			size: 8
		});
		bytesRead++;
	} else if (opcode === 0x75) {
		// JNE rel8
		operandName = "JNE";
		operandSet.push({
			type: 'imm',
			val: buf.readInt8(addr),
			size: 8
		});
		bytesRead++;
	} else if (opcode === 0x76) {
		// JBE rel8
		operandName = "JBE";
		operandSet.push({
			type: 'imm',
			val: buf.readInt8(addr),
			size: 8
		});
		bytesRead++;
	} else if (opcode === 0x77) {
		// JA rel8
		operandName = "JA";
		operandSet.push({
			type: 'imm',
			val: buf.readInt8(addr),
			size: 8
		});
		bytesRead++;
	} else if (opcode === 0x78) {
		// JS rel8
		operandName = "JS";
		operandSet.push({
			type: 'imm',
			val: buf.readInt8(addr),
			size: 8
		});
		bytesRead++;
	} else if (opcode === 0x79) {
		// JNS rel8
		operandName = "JNS";
		operandSet.push({
			type: 'imm',
			val: buf.readInt8(addr),
			size: 8
		});
		bytesRead++;
	} else if (opcode === 0x7A) {
		// JP rel8
		operandName = "JP";
		operandSet.push({
			type: 'imm',
			val: buf.readInt8(addr),
			size: 8
		});
		bytesRead++;
	} else if (opcode === 0x7B) {
		// JNP rel8
		operandName = "JNP";
		operandSet.push({
			type: 'imm',
			val: buf.readInt8(addr),
			size: 8
		});
		bytesRead++;
	} else if (opcode === 0x7C) {
		// JL rel8
		operandName = "JL";
		operandSet.push({
			type: 'imm',
			val: buf.readInt8(addr),
			size: 8
		});
		bytesRead++;
	} else if (opcode === 0x7D) {
		// JGE rel8
		operandName = "JGE";
		operandSet.push({
			type: 'imm',
			val: buf.readInt8(addr),
			size: 8
		});
		bytesRead++;
	} else if (opcode === 0x7E) {
		// JLE rel8
		operandName = "JLE";
		operandSet.push({
			type: 'imm',
			val: buf.readInt8(addr),
			size: 8
		});
		bytesRead++;
	} else if (opcode === 0x7F) {
		// JG rel8
		operandName = "JG";
		operandSet.push({
			type: 'imm',
			val: buf.readInt8(addr),
			size: 8
		});
		bytesRead++;
	} else if (opcode === 0x80) {
		// various instructions encoded by Mod R/M reg field
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;
		
		if (reg === 0x00) {
			// ADD r/m8, imm8
			operandName = "ADD";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			operandSet.push({
				type: 'imm',
				val: buf.readInt8(addr),
				size: 8
			});
			bytesRead++;
		} else if (reg === 0x01) {
			// OR r/m8, imm8
			operandName = "OR";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			operandSet.push({
				type: 'imm',
				val: buf.readInt8(addr),
				size: 8
			});
			bytesRead++;
		} else if (reg === 0x03) {
			// SBB r/m8, imm8
			operandName = "SBB";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			operandSet.push({
				type: 'imm',
				val: buf.readInt8(addr),
				size: 8
			});
			bytesRead++;
		} else if (reg === 0x04) {
			// AND r/m8, imm8
			operandName = "AND";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			operandSet.push({
				type: 'imm',
				val: buf.readInt8(addr),
				size: 8
			});
			bytesRead++;
		} else if (reg === 0x05) {
			// SUB r/m8, imm8
			operandName = "SUB";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			operandSet.push({
				type: 'imm',
				val: buf.readInt8(addr),
				size: 8
			});
			bytesRead++;
		} else if (reg === 0x06) {
			// XOR r/m8, imm8
			operandName = "XOR";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			operandSet.push({
				type: 'imm',
				val: buf.readInt8(addr),
				size: 8
			});
			bytesRead++;
		} else if (reg === 0x07) {
			// CMP r/m8, imm8
			operandName = "CMP";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			operandSet.push({
				type: 'imm',
				val: buf.readInt8(addr),
				size: 8
			});
			bytesRead++;
		}
	} else if (opcode === 0x81) {
		// various instructions encoded by Mod R/M reg field
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;
		
		if (reg === 0x00) {
			// ADD r/m16, imm16 | ADD r/m32, imm32
			operandName = "ADD";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			const sized = ReadSizedImmediate(buf, addr, opChangeSize);
			bytesRead += sized.bytesRead;
			operandSet.push(...sized.operands);
		} else if (reg === 0x01) {
			// OR r/m16, imm16 | OR r/m32, imm32
			operandName = "OR";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			const sized = ReadSizedImmediate(buf, addr, opChangeSize);
			bytesRead += sized.bytesRead;
			operandSet.push(...sized.operands);
		} else if (reg === 0x03) {
			// SBB r/m16, imm16 | SBB r/m32, imm32
			operandName = "SBB";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			const sized = ReadSizedImmediate(buf, addr, opChangeSize);
			bytesRead += sized.bytesRead;
			operandSet.push(...sized.operands);
		} else if (reg === 0x04) {
			// AND r/m16, imm16 | AND r/m32, imm32
			operandName = "AND";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			const sized = ReadSizedImmediate(buf, addr, opChangeSize);
			bytesRead += sized.bytesRead;
			operandSet.push(...sized.operands);
		} else if (reg === 0x05) {
			// SUB r/m16, imm16 | SUB r/m32, imm32
			operandName = "SUB";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			const sized = ReadSizedImmediate(buf, addr, opChangeSize);
			bytesRead += sized.bytesRead;
			operandSet.push(...sized.operands);
		} else if (reg === 0x06) {
			// XOR r/m16, imm16 | XOR r/m32, imm32
			operandName = "XOR";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			const sized = ReadSizedImmediate(buf, addr, opChangeSize);
			bytesRead += sized.bytesRead;
			operandSet.push(...sized.operands);
		} else if (reg === 0x07) {
			// CMP r/m16, imm16 | CMP r/m32, imm32
			operandName = "CMP";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			const sized = ReadSizedImmediate(buf, addr, opChangeSize);
			bytesRead += sized.bytesRead;
			operandSet.push(...sized.operands);
		}
	} else if (opcode === 0x83) {
		// various instructions encoded by Mod R/M reg field
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;
		
		if (reg === 0x00) {
			// ADD r/m16, imm8 | ADD r/m32, imm8
			operandName = "ADD";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			operandSet.push({
				type: 'imm',
				val: buf.readInt8(addr),
				size: 8
			});
			bytesRead++;
		} else if (reg === 0x01) {
			// OR r/m16, imm8 | OR r/m32, imm8
			operandName = "OR";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			operandSet.push({
				type: 'imm',
				val: buf.readInt8(addr),
				size: 8
			});
			bytesRead++;
		} else if (reg === 0x03) {
			// SBB r/m16, imm8 | SBB r/m32, imm8
			operandName = "SBB";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			operandSet.push({
				type: 'imm',
				val: buf.readInt8(addr),
				size: 8
			});
			bytesRead++;
		} else if (reg === 0x04) {
			// AND r/m16, imm8 | AND r/m32, imm8
			operandName = "AND";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			operandSet.push({
				type: 'imm',
				val: buf.readInt8(addr),
				size: 8
			});
			bytesRead++;
		} else if (reg === 0x05) {
			// SUB r/m16, imm8 | SUB r/m32, imm8
			operandName = "SUB";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			operandSet.push({
				type: 'imm',
				val: buf.readInt8(addr),
				size: 8
			});
			bytesRead++;
		} else if (reg === 0x06) {
			// XOR r/m16, imm8 | XOR r/m32, imm8
			operandName = "XOR";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			operandSet.push({
				type: 'imm',
				val: buf.readInt8(addr),
				size: 8
			});
			bytesRead++;
		} else if (reg === 0x07) {
			// CMP r/m16, imm8 | CMP r/m32, imm8
			operandName = "CMP";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			operandSet.push({
				type: 'imm',
				val: buf.readInt8(addr),
				size: 8
			});
			bytesRead++;
		}
	} else if (opcode === 0x84) {
		// TEST r/m8, r8
		operandName = "TEST";
		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: 8
		});
	} else if (opcode === 0x85) {
		// TEST r/m16, r16 | TEST r/m32, r32
		operandName = "TEST";
		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: opChangeSize ? 16 : 32
		});
	} else if (opcode === 0x86) {
		// XCHG r/m8, r8
		operandName = "XCHG";
		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: 8
		});
	} else if (opcode === 0x87) {
		// XCHG r/m16, r16 | XCHG r/m32, r32
		operandName = "XCHG";
		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: opChangeSize ? 16 : 32
		});
	} else if (opcode === 0x88) {
		// MOV r/m8, r8
		operandName = "MOV";
		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: 8
		});
	} else if (opcode === 0x89) {
		// MOV r/m16, r16 | MOV r/m32, r32
		operandName = "MOV";
		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: opChangeSize ? 16 : 32
		});
	} else if (opcode === 0x8A) {
		// MOV r8, r/m8
		operandName = "MOV";
		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: 8
		});

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x8B) {
		// MOV r16, r/m16 | MOV r32, r/m32
		operandName = "MOV";
		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: opChangeSize ? 16 : 32
		});

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x8C) {
		// MOV r/m16, seg | MOV r/m32, seg
		operandName = "MOV";
		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;

		operandSet.push({
			type: 'seg',
			val: reg,
			size: opChangeSize ? 16 : 32
		});
	} else if (opcode === 0x8D) {
		// LEA r16, m | LEA r32, m
		operandName = "LEA";
		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: opChangeSize ? 16 : 32
		});

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x8F) {
		// various instructions encoded by Mod R/M reg field
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;
		
		if (reg === 0x00) {
			// POP r/m16 | POP r/m32
			operandName = "POP";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
		}
	} else if (opcode === 0x90) {
		// NOP
		operandName = "NOP";
	} else if (opcode >= 0x91 && opcode <= 0x97) {
		// XCHG AX, r16 | XCHG EAX, r32
		operandName = "XCHG";

		operandSet.push({
			type: 'reg',
			val: opcode - 0x90,
			size: opChangeSize ? 16 : 32
		});
		operandSet.push({
			type: 'reg',
			val: 0x00,
			size: opChangeSize ? 16 : 32
		});
	} else if (opcode === 0x9A) {
		// CALL ptr16:16 | CALL ptr16:32
		operandName = "CALL";
		// just two immediates, first one depends on the operand size change
		const sized = ReadSizedImmediate(buf, addr, opChangeSize);
		bytesRead += sized.bytesRead;
		operandSet.push(...sized.operands);

		operandSet.push({
			type: 'imm',
			val: buf.readInt16LE(addr),
			size: 16
		});
		bytesRead += 2;
		// fixup the order of operations
		operandSet.push(operandSet.shift());
	} else if (opcode === 0x9C) {
		// PUSHFD
		operandName = "PUSHFD";
	} else if (opcode === 0x9D) {
		// POPFD
		operandName = "POPFD";
	} else if (opcode === 0xA0) {
		// MOV AL, moffs8
		operandName = "MOV";
		operandSet.push({
			type: 'reg',
			val: 0x00,
			size: 8
		});
		operandSet.push({
			type: 'moffs',
			val: buf.readInt8(addr),
			size: 8
		});
		bytesRead++;
	} else if (opcode === 0xA1) {
		// MOV AX, moffs16 | MOV EAX, moffs32
		operandName = "MOV";
		operandSet.push({
			type: 'reg',
			val: 0x00,
			size: opChangeSize ? 16 : 32
		});
		// moffs is always 32-bit?
		operandSet.push({
			type: 'moffs',
			val: buf.readInt32LE(addr),
			size: 32
		});
		bytesRead += 4;
	} else if (opcode === 0xA2) {
		// MOV moffs8, AL
		operandName = "MOV";
		operandSet.push({
			type: 'moffs',
			val: buf.readInt8(addr),
			size: 8
		});
		bytesRead++;
		operandSet.push({
			type: 'reg',
			val: 0x00,
			size: 8
		});
	} else if (opcode === 0xA3) {
		// MOV moffs16, AX | MOV moffs32, EAX
		operandName = "MOV";

		// moffs is always 32-bit?
		operandSet.push({
			type: 'moffs',
			val: buf.readInt32LE(addr),
			size: 32
		});
		bytesRead += 4;

		operandSet.push({
			type: 'reg',
			val: 0x00,
			size: opChangeSize ? 16 : 32
		});
	} else if (opcode === 0xA8) {
		// TEST AL, imm8
		operandName = "TEST";

		operandSet.push({
			type: 'reg',
			val: 0x00,
			size: 8
		});
		operandSet.push({
			type: 'imm',
			val: buf.readInt8(addr),
			size: 8
		});
	} else if (opcode === 0xA9) {
		// TEST AX, imm16 | TEST EAX, imm32
		operandName = "TEST";

		operandSet.push({
			type: 'reg',
			val: 0x00,
			size: opChangeSize ? 16 : 32
		});
		
		const sized = ReadSizedImmediate(buf, addr, opChangeSize);
		bytesRead += sized.bytesRead;
		operandSet.push(...sized.operands);
	} else if (opcode === 0xAA) {
		// STOSB
		operandName = "STOSB";
	} else if (opcode === 0xAB) {
		// STOSW | STOSD (form is selected by prefix)
		operandName = "STOS";
	} else if (opcode >= 0xB0 && opcode <= 0xB7) {
		// MOV r8, imm8
		// r8 is encoded in the opcode number
		operandName = "MOV";

		operandSet.push({
			type: 'reg',
			val: opcode - 0xB0,
			size: 8
		});
		operandSet.push({
			type: 'imm',
			val: buf.readInt8(addr),
			size: 8
		});
		bytesRead++;
	} else if (opcode >= 0xB8 && opcode <= 0xBF) {
		// MOV r16, imm16 | MOV r32, imm32
		// r* is encoded in the opcode number
		operandName = "MOV";

		operandSet.push({
			type: 'reg',
			val: opcode - 0xB8,
			size: opChangeSize ? 16 : 32
		});

		const sized = ReadSizedImmediate(buf, addr, opChangeSize);
		bytesRead += sized.bytesRead;
		operandSet.push(...sized.operands);
	} else if (opcode === 0xC0) {
		// various instructions encoded by Mod R/M reg field
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;
		
		if (reg === 0x04) {
			// SHL r/m8, imm8
			operandName = "SHL";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			operandSet.push({
				type: 'imm',
				val: buf.readInt8(addr),
				size: 8
			});
			bytesRead += 1;
		} else if (reg === 0x05) {
			// SHR r/m8, imm8
			operandName = "SHR";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			operandSet.push({
				type: 'imm',
				val: buf.readInt8(addr),
				size: 8
			});
			bytesRead += 1;
		} else if (reg === 0x07) {
			// SAR r/m8, imm8
			operandName = "SAR";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			operandSet.push({
				type: 'imm',
				val: buf.readInt8(addr),
				size: 8
			});
			bytesRead += 1;
		}
	} else if (opcode === 0xC1) {
		// various instructions encoded by Mod R/M reg field
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;
		
		if (reg === 0x04) {
			// SHL r/m16, imm8 | SHL r/m32, imm8
			operandName = "SHL";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			operandSet.push({
				type: 'imm',
				val: buf.readInt8(addr),
				size: 8
			});
			bytesRead += 1;
		} else if (reg === 0x05) {
			// SHR r/m16, imm8 | SHR r/m32, imm8
			operandName = "SHR";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			operandSet.push({
				type: 'imm',
				val: buf.readInt8(addr),
				size: 8
			});
			bytesRead += 1;
		} else if (reg === 0x07) {
			// SAR r/m16, imm8 | SAR r/m32, imm8
			operandName = "SAR";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			operandSet.push({
				type: 'imm',
				val: buf.readInt8(addr),
				size: 8
			});
			bytesRead += 1;
		}
	} else if (opcode === 0xC2 || opcode === 0xCA) {
		// RET imm16
		operandName = "RET";
		operandSet.push({
			type: 'imm',
			val: buf.readInt16LE(addr),
			size: 16
		});
		bytesRead += 2;
	} else if (opcode === 0xC3 || opcode === 0xCB) {
		// RET
		operandName = "RET";
	} else if (opcode === 0xC6) {
		// various instructions encoded by Mod R/M reg field
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;
		
		if (reg === 0x00) {
			// MOV r/m8, imm8
			operandName = "MOV";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			operandSet.push({
				type: 'imm',
				val: buf.readInt8(addr),
				size: 8
			});
			bytesRead++;
		}
	} else if (opcode === 0xC7) {
		// various instructions encoded by Mod R/M reg field
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;
		
		if (reg === 0x00) {
			// MOV r/m16, imm16 | MOV r/m32, imm32
			operandName = "MOV";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			const sized = ReadSizedImmediate(buf, addr, opChangeSize);
			bytesRead += sized.bytesRead;
			operandSet.push(...sized.operands);
		}
	} else if (opcode === 0xCC) {
		// INT 3
		operandName = "INT";
		operandSet.push({
			type: 'imm',
			val: 0x03,
			size: 8
		});
	} else if (opcode === 0xCD) {
		// INT imm8
		operandName = "INT";
		operandSet.push({
			type: 'imm',
			val: buf.readInt8(addr),
			size: 8
		});
		bytesRead++;
	} else if (opcode === 0xCE) {
		// INTO
		operandName = "INTO";
	} else if (opcode === 0xD0) {
		// various instructions encoded by Mod R/M reg field
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;
		
		if (reg === 0x04) {
			// SHL r/m8
			operandName = "SHL";
			const processed = ApplyModRM(buf, addr, mod, rm, 8);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;
		} else if (reg === 0x05) {
			// SHR r/m8
			operandName = "SHR";
			const processed = ApplyModRM(buf, addr, mod, rm, 8);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;
		} else if (reg === 0x07) {
			// SAR r/m8
			operandName = "SAR";
			const processed = ApplyModRM(buf, addr, mod, rm, 8);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;
		}
	} else if (opcode === 0xD1) {
		// various instructions encoded by Mod R/M reg field
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;
		
		if (reg === 0x04) {
			// SHL r/m16 | SHL r/m32
			operandName = "SHL";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;
		} else if (reg === 0x05) {
			// SHR r/m16 | SHR r/m32
			operandName = "SHR";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;
		} else if (reg === 0x07) {
			// SAR r/m16 | SAR r/m32
			operandName = "SAR";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;
		}
	} else if (opcode === 0xD2) {
		// various instructions encoded by Mod R/M reg field
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;
		
		if (reg === 0x04) {
			// SHL r/m8, CL
			operandName = "SHL";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			operandSet.push({
				type: 'reg',
				val: 0x01,
				size: 8
			});
		} else if (reg === 0x05) {
			// SHR r/m8, CL
			operandName = "SHR";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			operandSet.push({
				type: 'reg',
				val: 0x01,
				size: 8
			});
		} else if (reg === 0x07) {
			// SAR r/m8, CL
			operandName = "SAR";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			operandSet.push({
				type: 'reg',
				val: 0x01,
				size: 8
			});
		}
	} else if (opcode === 0xD3) {
		// various instructions encoded by Mod R/M reg field
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;
		
		if (reg === 0x04) {
			// SHL r/m16, CL | SHL r/m32, CL
			operandName = "SHL";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			operandSet.push({
				type: 'reg',
				val: 0x01,
				size: 8
			});
		} else if (reg === 0x05) {
			// SHR r/m16, CL | SHR r/m32, CL
			operandName = "SHR";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			operandSet.push({
				type: 'reg',
				val: 0x01,
				size: 8
			});
		} else if (reg === 0x07) {
			// SAR r/m16, CL | SAR r/m32, CL
			operandName = "SAR";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			operandSet.push({
				type: 'reg',
				val: 0x01,
				size: 8
			});
		}
	} else if (opcode === 0xE3) {
		// JECXZ rel8
		operandName = "JECXZ";
		operandSet.push({
			type: 'imm',
			val: buf.readInt8(addr),
			size: 8
		});
		bytesRead++;
	} else if (opcode === 0xE9) {
		// JMP rel16 | JMP rel32
		operandName = "JMP";

		const sized = ReadSizedImmediate(buf, addr, opChangeSize);
		bytesRead += sized.bytesRead;
		operandSet.push(...sized.operands);
	} else if (opcode === 0xE8) {
		// CALL rel16 | CALL rel32
		operandName = "CALL";

		const sized = ReadSizedImmediate(buf, addr, opChangeSize);
		bytesRead += sized.bytesRead;
		operandSet.push(...sized.operands);
	} else if (opcode === 0xEA) {
		// JMP ptr16:16 | JMP ptr16:32
		operandName = "JMP";

		const sized = ReadSizedImmediate(buf, addr, opChangeSize);
		bytesRead += sized.bytesRead;
		operandSet.push(...sized.operands);

		operandSet.push({
			type: 'imm',
			val: buf.readInt16LE(addr),
			size: 16
		});
		bytesRead += 2;
	} else if (opcode === 0xEB) {
		// JMP rel8
		operandName = "JMP";
		operandSet.push({
			type: 'imm',
			val: buf.readInt8(addr),
			size: 8
		});
		bytesRead += 1;
	} else if (opcode === 0xF6) {
		// various instructions encoded by Mod R/M reg field
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;
		
		if (reg === 0x00) {
			// TEST r/m8, imm8
			operandName = "TEST";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			operandSet.push({
				type: 'imm',
				val: buf.readInt8(addr),
				size: 8
			});
			bytesRead++;
		} else if (reg === 0x02) {
			// NOT r/m8
			operandName = "NOT";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
		}
	} else if (opcode === 0xF7) {
		// various instructions encoded by Mod R/M reg field
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;
		
		if (reg === 0x00) {
			// TEST r/m16, imm16 | TEST r/m32, imm32
			operandName = "TEST";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
			addr += processed.bytesRead;

			const sized = ReadSizedImmediate(buf, addr, opChangeSize);
			bytesRead += sized.bytesRead;
			operandSet.push(...sized.operands);
		} else if (reg === 0x02) {
			// NOT r/m16 | NOT r/m32
			operandName = "NOT";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
		}
	} else if (opcode === 0xFE) {
		// various instructions encoded by Mod R/M reg field
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;
		
		if (reg === 0x00) {
			// INC r/m8
			operandName = "INC";
			const processed = ApplyModRM(buf, addr, mod, rm, 8);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
		}
	} else if (opcode === 0xFF) {
		// various instructions encoded by Mod R/M reg field
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;
		
		if (reg === 0x00) {
			// INC r/m16 | INC r/m32
			operandName = "INC";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
		} else if (reg === 0x02) {
			// CALL r/m16 | CALL r/m32
			operandName = "CALL";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
		} else if (reg === 0x03) {
			// CALL m16:16 | CALL m16:32 TODO
		} else if (reg === 0x04) {
			// JMP r/m16 | JMP r/m32
			operandName = "JMP";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
		} else if (reg === 0x05) {
			// JMP m16:16 | JMP m16:32 TODO
		} else if (reg === 0x06) {
			// PUSH r/m16 | PUSH r/m32
			operandName = "PUSH";
			const processed = ApplyModRM(buf, addr, mod, rm);
			operandSet.push(...processed.operands);
			bytesRead += processed.bytesRead;
		}
	} else if (opcode === 0x0F01) {
		// XGETBV xcr
		operandName = "XGETBV";
		
		// argument to this is always 0xD0. currently, other control registers are unsupported.
		bytesRead++;
	} else if (opcode === 0x0F12) {
		// MOVLPD xmm, m64
		operandName = "MOVLPD";
		
		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: 128
		});

		const processed = ApplyModRM(buf, addr, mod, rm, 128);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x0F13) {
		// MOVLPD m64, xmm
		operandName = "MOVLPD";
		
		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		const processed = ApplyModRM(buf, addr, mod, rm, 128);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: 128
		});
	} else if (opcode === 0x0F57) {
		// XORPS xmm1, xmm2/m128
		operandName = "XORPS";
		
		// registers/displacements encoded by Mod R/M
		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: 128
		});

		const processed = ApplyModRM(buf, addr, mod, rm, 128);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x0F80) {
		// JO rel16 | rel32
		operandName = "JO";
		
		const sized = ReadSizedImmediate(buf, addr, opChangeSize);
		bytesRead += sized.bytesRead;
		operandSet.push(...sized.operands);
	} else if (opcode === 0x0F81) {
		// JNO rel16 | rel32
		operandName = "JNO";
		
		const sized = ReadSizedImmediate(buf, addr, opChangeSize);
		bytesRead += sized.bytesRead;
		operandSet.push(...sized.operands);
	} else if (opcode === 0x0F82) {
		// JB rel16 | rel32
		operandName = "JB";
		
		const sized = ReadSizedImmediate(buf, addr, opChangeSize);
		bytesRead += sized.bytesRead;
		operandSet.push(...sized.operands);
	} else if (opcode === 0x0F83) {
		// JAE rel16 | rel32
		operandName = "JAE";
		
		const sized = ReadSizedImmediate(buf, addr, opChangeSize);
		bytesRead += sized.bytesRead;
		operandSet.push(...sized.operands);
	} else if (opcode === 0x0F84) {
		// JE rel16 | rel32
		operandName = "JE";
		
		const sized = ReadSizedImmediate(buf, addr, opChangeSize);
		bytesRead += sized.bytesRead;
		operandSet.push(...sized.operands);
	} else if (opcode === 0x0F85) {
		// JNE rel16 | rel32
		operandName = "JNE";
		
		const sized = ReadSizedImmediate(buf, addr, opChangeSize);
		bytesRead += sized.bytesRead;
		operandSet.push(...sized.operands);
	} else if (opcode === 0x0F86) {
		// JBE rel16 | rel32
		operandName = "JBE";
		
		const sized = ReadSizedImmediate(buf, addr, opChangeSize);
		bytesRead += sized.bytesRead;
		operandSet.push(...sized.operands);
	} else if (opcode === 0x0F87) {
		// JA rel16 | rel32
		operandName = "JA";
		
		const sized = ReadSizedImmediate(buf, addr, opChangeSize);
		bytesRead += sized.bytesRead;
		operandSet.push(...sized.operands);
	} else if (opcode === 0x0F88) {
		// JS rel16 | rel32
		operandName = "JS";
		
		const sized = ReadSizedImmediate(buf, addr, opChangeSize);
		bytesRead += sized.bytesRead;
		operandSet.push(...sized.operands);
	} else if (opcode === 0x0F89) {
		// JNS rel16 | rel32
		operandName = "JNS";
		
		const sized = ReadSizedImmediate(buf, addr, opChangeSize);
		bytesRead += sized.bytesRead;
		operandSet.push(...sized.operands);
	} else if (opcode === 0x0F8A) {
		// JP rel16 | rel32
		operandName = "JP";
		
		const sized = ReadSizedImmediate(buf, addr, opChangeSize);
		bytesRead += sized.bytesRead;
		operandSet.push(...sized.operands);
	} else if (opcode === 0x0F8B) {
		// JNP rel16 | rel32
		operandName = "JNP";
		
		const sized = ReadSizedImmediate(buf, addr, opChangeSize);
		bytesRead += sized.bytesRead;
		operandSet.push(...sized.operands);
	} else if (opcode === 0x0F8C) {
		// JL rel16 | rel32
		operandName = "JL";
		
		const sized = ReadSizedImmediate(buf, addr, opChangeSize);
		bytesRead += sized.bytesRead;
		operandSet.push(...sized.operands);
	} else if (opcode === 0x0F8D) {
		// JGE rel16 | rel32
		operandName = "JGE";
		
		const sized = ReadSizedImmediate(buf, addr, opChangeSize);
		bytesRead += sized.bytesRead;
		operandSet.push(...sized.operands);
	} else if (opcode === 0x0F8E) {
		// JLE rel16 | rel32
		operandName = "JLE";
		
		const sized = ReadSizedImmediate(buf, addr, opChangeSize);
		bytesRead += sized.bytesRead;
		operandSet.push(...sized.operands);
	} else if (opcode === 0x0F8F) {
		// JG rel16 | rel32
		operandName = "JG";
		
		const sized = ReadSizedImmediate(buf, addr, opChangeSize);
		bytesRead += sized.bytesRead;
		operandSet.push(...sized.operands);
	} else if (opcode === 0x0F90) {
		// SETO r/m8
		operandName = "SETO";

		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;
		
		const processed = ApplyModRM(buf, addr, mod, rm, 8);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x0F91) {
		// SETNO r/m8
		operandName = "SETNO";

		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;
		
		const processed = ApplyModRM(buf, addr, mod, rm, 8);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x0F92) {
		// SETB r/m8
		operandName = "SETB";

		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;
		
		const processed = ApplyModRM(buf, addr, mod, rm, 8);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x0F93) {
		// SETAE r/m8
		operandName = "SETAE";

		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;
		
		const processed = ApplyModRM(buf, addr, mod, rm, 8);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x0F94) {
		// SETE r/m8
		operandName = "SETE";

		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;
		
		const processed = ApplyModRM(buf, addr, mod, rm, 8);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x0F95) {
		// SETNE r/m8
		operandName = "SETNE";

		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;
		
		const processed = ApplyModRM(buf, addr, mod, rm, 8);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x0F96) {
		// SETBE r/m8
		operandName = "SETBE";

		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;
		
		const processed = ApplyModRM(buf, addr, mod, rm, 8);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x0F97) {
		// SETA r/m8
		operandName = "SETA";

		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;
		
		const processed = ApplyModRM(buf, addr, mod, rm, 8);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x0F98) {
		// SETS r/m8
		operandName = "SETS";

		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;
		
		const processed = ApplyModRM(buf, addr, mod, rm, 8);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x0F99) {
		// SETNS r/m8
		operandName = "SETNS";

		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;
		
		const processed = ApplyModRM(buf, addr, mod, rm, 8);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x0F9A) {
		// SETP r/m8
		operandName = "SETP";

		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;
		
		const processed = ApplyModRM(buf, addr, mod, rm, 8);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x0F9B) {
		// SETNP r/m8
		operandName = "SETNP";

		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;
		
		const processed = ApplyModRM(buf, addr, mod, rm, 8);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x0F9C) {
		// SETL r/m8
		operandName = "SETL";

		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;
		
		const processed = ApplyModRM(buf, addr, mod, rm, 8);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x0F9D) {
		// SETGE r/m8
		operandName = "SETGE";

		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;
		
		const processed = ApplyModRM(buf, addr, mod, rm, 8);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x0F9E) {
		// SETLE r/m8
		operandName = "SETLE";

		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;
		
		const processed = ApplyModRM(buf, addr, mod, rm, 8);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x0F9F) {
		// SETG r/m8
		operandName = "SETG";

		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;
		
		const processed = ApplyModRM(buf, addr, mod, rm, 8);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x0FB0) {
		// CMPXCHG r/m8, r8
		operandName = "CMPXCHG";

		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		const processed = ApplyModRM(buf, addr, mod, rm, 8);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
		
		operandSet.push({
			type: 'reg',
			val: reg,
			size: 8
		});
	} else if (opcode === 0x0FB1) {
		// CMPXCHG r/m16, r16 | CMPXCHG r/m32, r32
		operandName = "CMPXCHG";

		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		const processed = ApplyModRM(buf, addr, mod, rm, 8);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: opChangeSize ? 16 : 32
		});
	} else if (opcode === 0x0FB6) {
		// MOVZX r16, r/m8 | MOVZX r32, r/m8
		operandName = "MOVZX";

		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: opChangeSize ? 16 : 32
		});

		const processed = ApplyModRM(buf, addr, mod, rm, 8);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x0FB7) {
		// MOVZX r32, r/m16
		operandName = "MOVZX";

		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: 32
		});

		const processed = ApplyModRM(buf, addr, mod, rm, 16);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	} else if (opcode === 0x0FA2) {
		// CPUID
		operandName = "CPUID";
	} else if (opcode === 0x0FAF) {
		// IMUL r16, r/m16 | IMUL r32, r/m32
		operandName = "IMUL";

		const { mod, reg, rm } = ReadModRM(buf, addr++);
		bytesRead += 1;

		operandSet.push({
			type: 'reg',
			val: reg,
			size: opChangeSize ? 16 : 32
		});

		const processed = ApplyModRM(buf, addr, mod, rm);
		operandSet.push(...processed.operands);
		bytesRead += processed.bytesRead;
	}
	
	return {
		operandSet,
		operandName,
		bytesRead
	};
};

const ProcessChunk = async (buf, addr, chunkRanges, fixupAddress) => {
	const chunkName = `FUN_${(addr + fixupAddress).toString(16).padStart(8, '0').toUpperCase()}`;
	const chunkData = [];
	const outstandingChunks = [];
	const conditionalJumpTargets = [];
	const addrStart = addr;
	while (true) {
		const instrStart = addr;
		// read first byte of new instruction
		let currByte = buf.readUInt8(addr++);
		// read prefix bytes into a set
		const prefixSet = [];
		// check each byte for prefix, then goto next byte
		while (prefixOps.includes(currByte)) {
			prefixSet.push(currByte);
			currByte = buf.readUInt8(addr++);
		}
		
		// determine the opcode, 2-bytes if extended
		let opcodeBytes = currByte;
		if (currByte === OPCODE_EXTENSION) {
			opcodeBytes = buf.readUInt16BE(addr++ - 1);
		}
		
		// operation size prefix test
		const opChangeSize = prefixSet.includes(0x66);
		
		// begin processing for this opcode
		const { operandSet, operandName, bytesRead } = ProcessOpcode(opcodeBytes, opChangeSize, buf, addr);
		addr += bytesRead;
		
		// error case - unrecognized opcode
		if (operandName === "") {
			console.log(JSON.stringify(chunkData, null, 2));
			console.log(`Error while processing function ${chunkName} at instruction 0x${(instrStart + fixupAddress).toString(16).toUpperCase()} - invalid opcode 0x${opcodeBytes.toString(16).toUpperCase()}`);
			return {
				chunkName,
				chunkRanges,
				outstandingChunks,
				chunkData,
				error: true
			};
		}
		
		// push this instruction to the chunk instruction list
		chunkData.push(Instruction(prefixSet, opcodeBytes, operandSet, instrStart, addr, operandName));
		
		// handle JMP and RET as chunk terminations
		if (operandName === "JMP" || operandName === "RET") {
			// store the range of this chunk's data
			chunkRanges.push({
				chunkRangeStart: addrStart,
				chunkRangeEnd: addr
			});
			// evaluate each conditional JMP, if not already included in the current chunk range.
			for (var jmp of conditionalJumpTargets) {
				// upper end is > and not >= as often, the subchunk will be right on the edge of the existing chunks.
				if (chunkRanges.some(x => x.chunkRangeStart <= jmp && x.chunkRangeEnd > jmp)) {
					continue;
				} else {
					// process the subchunk
					const subChunk = await ProcessChunk(buf, jmp, chunkRanges, fixupAddress);
					if (subChunk.error) return subChunk;
					// include new outstanding chunks
					for (var x of subChunk.outstandingChunks) {
						if (!outstandingChunks.includes(x)) outstandingChunks.push(x);
					}
					chunkData.push(...subChunk.chunkData);
				}
			}
			// for unconditional jump only - set the jump target as a new chunk target, if not included in evaluated ranges.
			if (operandName === "JMP") {
				const jmpTarget = addr + operandSet[0].val;
				if (!chunkRanges.some(x => x.chunkRangeStart <= jmpTarget && x.chunkRangeEnd >= jmpTarget) && !operandSet[0].indirect && operandSet[0].type !== 'reg') outstandingChunks.push(jmpTarget);
			}
			// quit
			break;
		}

		// handle CALL as an additional chunk to explore
		if (operandName === "CALL") {
			const callTarget = addr + operandSet[0].val;
			if (!chunkRanges.some(x => x.chunkRangeStart <= callTarget && x.chunkRangeEnd >= callTarget) && !operandSet[0].indirect && operandSet[0].type !== 'reg') outstandingChunks.push(callTarget);
		}

		// handle conditional JMPs as new locations in the current chunk
		if (conditionalJumpOps.includes(operandName)) {
			const jumpTarget = addr + operandSet[0].val;
			if (!chunkRanges.some(x => x.chunkRangeStart <= jumpTarget && x.chunkRangeEnd >= jumpTarget)) conditionalJumpTargets.push(jumpTarget);
		}
	}
	return {
		chunkName,
		chunkData,
		chunkRanges,
		outstandingChunks
	};
};

module.exports = {
	
	ProcessAllChunks: async function(buf, entrypoint, formalEntryPoint) {
		const newChunks = [], chunkRanges = [], allChunks = [];
		const fixupAddress = formalEntryPoint - entrypoint;
		
		let addr = entrypoint;
		while (true) {
			// check if this chunk was already processed at some point
			if (!chunkRanges.some(x => x.chunkRangeStart <= addr && x.chunkRangeEnd > addr)) {
				// process the chunk
				const currChunk = await ProcessChunk(buf, addr, [], fixupAddress);
				if (currChunk.error) return;
				// register the chunks still to be explored
				for (var x of currChunk.outstandingChunks) {
					if (!newChunks.includes(x)) newChunks.push(x);
				}
				// register the chunk ranges associated with this chunk
				for (var x of currChunk.chunkRanges) {
					if (!chunkRanges.includes(x)) chunkRanges.push(x);
				}
				// store the current chunk
				const chunkFinal = Chunk(currChunk.chunkName, currChunk.chunkData, currChunk.chunkRanges, []);
				allChunks.push(chunkFinal);
				
				console.log(`Processed new chunk ${currChunk.chunkName}`);
			}
			
			// check if chunk processing is complete
			if (newChunks.length === 0) {
				console.log(`Chunk processing completed successfully.`);
				break;
			}
			// progress to the new chunk
			addr = newChunks.shift();
		}

		return allChunks;
	},

	FixupChunkReferences: async function(chunks, thunkFixup, thunkMax, importList, buf) {
		// iterate all chunks in order to fixup references to addresses
		// (in e.g. JMP, CALL, etc...)
		// this also generates a list of branch targets per chunk
		for (var chunk of chunks) {	
			for (var instruction of chunk.instructions) {
				// instructions to fixup
				if (instruction.mnemonic === "JMP" || instruction.mnemonic === "CALL" || conditionalJumpOps.includes(instruction.mnemonic)) {
					const operand = instruction.operandSet[0];
					
					if (operand.indirect && operand.type === 'imm') {
						// immediate indirect operand implies this is a function call
						// indirects do not get offset from the instruction, they are absolute
						// these need to be fixup'd as function calls.
						const target = operand.val - thunkFixup;

						// if target is outside of the thunk range, it's likely to be sourced from another section
						// (e.g. .00cfg section contains a couple far pointers)
						// these will just be skipped for now.

						// need to determine the function being thunk'd
						if (target < thunkMax) {
							const thunked = buf.readInt32LE(target);
							const importDLL = importList.find(x => x.allImports.some(y => y.thunk === thunked));
							const importName = importDLL.allImports.find(y => y.thunk === thunked);
							if (!importName) {
								console.log(`No import exists to satisfy import located at 0x${operand.val.toString(16).toUpperCase()}`);
								return;
							} else {
								// import was identified, so update the reference
								instruction.mnemonic = "EXTERN";
								instruction.opcode = 0xFF01;
								instruction.operandSet = [
									{
										type: 'extern',
										val: `${importDLL.name}::${importName.name}`
									}
								];
							}
						}
					} else if (operand.type === 'imm') {
						// non-indirect is always immediate, this implies a branch
						// these are all offset from the next instruction
						const target = operand.val + instruction.next;
						// if the current chunk contains this target, we can drop early and stay within the current chunk
						if (chunk.instructions.some(x => x.address === target)) {
							// find the instruction number
							const instructionTarget = chunk.instructions.findIndex(x => x.address === target);
							// set the chunk ID to -1 to indicate to remain in the current chunk
							// update operands
							// operands for JMP/CALL are:
							// - module ID
							// - chunk ID
							// - instruction ID
							instruction.operandSet = [
								{
									type: 'imm',
									val: 1,
									size: 32
								},
								{
									type: 'imm',
									val: -1,
									size: 32
								},
								{
									type: 'imm',
									val: instructionTarget,
									size: 32
								},
							];
							if (!chunk.branchTargets.includes(instructionTarget)) chunk.branchTargets.push(instructionTarget);
						} else {
							// identify the chunk containing this target
							const targetChunk = chunks.filter(x => x.ranges.some(y => y.chunkRangeStart <= target && y.chunkRangeEnd > target));
							if (targetChunk.length === 0) {
								console.log(`No chunk exists to satisfy relocation to 0x${(target + fixup).toString(16).toUpperCase()}`);
								return;
							}

							// it's possible for targetChunk to match more than one chunk (if chunks have distinct starts, but overlapping contents).
							// this is generally fine, because the jmp will try to remain within the same chunk if possible, and will only depart if needed.
							const targetChunkID = chunks.findIndex(x => x.name === targetChunk[0].name);
							if (targetChunk[0].instructions.some(x => x.address === target)) {
								const instructionTarget = targetChunk[0].instructions.findIndex(x => x.address === target);
								// update operands
								// operands for JMP/CALL are:
								// - module ID
								// - chunk ID
								// - instruction ID
								instruction.operandSet = [
									{
										type: 'imm',
										val: 1,
										size: 32
									},
									{
										type: 'imm',
										val: targetChunkID,
										size: 32
									},
									{
										type: 'imm',
										val: instructionTarget,
										size: 32
									},
								];
								if (!targetChunk[0].branchTargets.includes(instructionTarget)) targetChunk[0].branchTargets.push(instructionTarget);
							} else {
								console.log(`No instruction exists in chosen chunk to satisfy relocation to 0x${(target + fixup).toString(16).toUpperCase()}`);
								return;
							}
						}
						
					}
				}
			}
		}
	}
	
};