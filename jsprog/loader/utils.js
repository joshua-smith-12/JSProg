function getNullTerminatedString(buffer, address) {
	let strCurrPtr = address;
	let str = "";
	// read the import name
	while (buffer.readUInt8(strCurrPtr) !== 0x00) {
		str += buffer.toString('utf8', strCurrPtr, strCurrPtr + 1);
		strCurrPtr++;
	}
	return str;
}

const conditionalJumpOps = [
	"JA", "JAE", "JB", "JBE", "JC", "JCXZ", "JECXZ", "JE", "JG", "JGE", "JL", "JLE", 
	"JNA", "JNAE", "JNB", "JNBE", "JNC", "JNE", "JNG", "JNGE", "JNL", "JNLE", "JNO", 
	"JNP", "JNS", "JNZ", "JO", "JP", "JPE", "JPO", "JS", "JZ"
];

module.exports = {
	getNullTerminatedString,
	conditionalJumpOps
};