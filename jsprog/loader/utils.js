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

// https://stackoverflow.com/a/24947000
function toBytesInt32 (num) {
    const arr = new ArrayBuffer(4); // an Int32 takes 4 bytes
    const view = new DataView(arr);
    view.setUint32(0, num, false); // byteOffset = 0; litteEndian = false
    return arr;
}

const conditionalJumpOps = [
	"JA", "JAE", "JB", "JBE", "JC", "JCXZ", "JECXZ", "JE", "JG", "JGE", "JL", "JLE", 
	"JNA", "JNAE", "JNB", "JNBE", "JNC", "JNE", "JNG", "JNGE", "JNL", "JNLE", "JNO", 
	"JNP", "JNS", "JNZ", "JO", "JP", "JPE", "JPO", "JS", "JZ"
];

module.exports = {
	getNullTerminatedString,
	toBytesInt32,
	conditionalJumpOps
};