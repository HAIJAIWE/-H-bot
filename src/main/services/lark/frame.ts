// @ts-nocheck
// 由 10/18 打包产物还原（chunk: index.js）；见 _recovery/README-recovery.md

/** 帧类型：0=控制帧，1=数据帧 */
var FrameType = {
	control: 0,
	data: 1
};
/** 消息类型（放在 `type` 头里） */
var MessageType = {
	event: "event",
	card: "card",
	ping: "ping",
	pong: "pong"
};
/** 头字段名 */
var HeaderKey = {
	type: "type",
	messageId: "message_id",
	sum: "sum",
	seq: "seq",
	traceId: "trace_id",
	bizRt: "biz_rt",
	handshakeStatus: "handshake-status",
	handshakeMsg: "handshake-msg",
	handshakeAuthErrcode: "handshake-autherrcode"
};
/** 错误码 */
var LarkWsErrorCode = {
	ok: 0,
	system_busy: 1,
	forbidden: 403,
	auth_failed: 514,
	internal_error: 1000040343,
	exceed_conn_limit: 1000040350
};
/** 写一个 varint（无符号，按 protobuf 的 7 位分组小端序） */
function writeVarint(value) {
	const out = [];
	let v = value;
	if (v < 0) throw new Error(`varint 不接受负数: ${value}`);
	do {
		const byte = v % 128;
		v = Math.floor(v / 128);
		out.push(v > 0 ? byte | 128 : byte);
	} while (v > 0);
	return out;
}
/** 读一个 varint。越界/超长（>10 字节）视为损坏并抛错 */
function readVarint(buf, offset) {
	let value = 0;
	let shift = 1;
	let bytesRead = 0;
	for (;;) {
		if (offset + bytesRead >= buf.length) throw new Error("varint 读取越界（帧被截断）");
		const byte = buf[offset + bytesRead];
		bytesRead++;
		value += (byte & 127) * shift;
		if ((byte & 128) === 0) break;
		shift *= 128;
		if (bytesRead > 10) throw new Error("varint 超过 10 字节（帧损坏）");
	}
	return {
		value,
		bytesRead
	};
}
/**
* 编码一个 `Frame`。
*
* 字段顺序与官方生成代码一致（写字段必须按字段号升序，protobuf 要求）。
*/
function encodeFrame(frame) {
	const out = [];
	out.push(8, ...writeVarint(frame.SeqID));
	out.push(16, ...writeVarint(frame.LogID));
	out.push(24, ...writeVarint(frame.service));
	out.push(32, ...writeVarint(frame.method));
	for (const h of frame.headers) {
		const inner = encodeHeader(h);
		out.push(42, ...writeVarint(inner.length), ...inner);
	}
	if (frame.payloadEncoding != null) {
		const b = utf8Encode(frame.payloadEncoding);
		out.push(50, ...writeVarint(b.length), ...b);
	}
	if (frame.payloadType != null) {
		const b = utf8Encode(frame.payloadType);
		out.push(58, ...writeVarint(b.length), ...b);
	}
	if (frame.payload != null) out.push(66, ...writeVarint(frame.payload.length), ...frame.payload);
	if (frame.LogIDNew != null) {
		const b = utf8Encode(frame.LogIDNew);
		out.push(74, ...writeVarint(b.length), ...b);
	}
	return Uint8Array.from(out);
}
function encodeHeader(h) {
	const k = utf8Encode(h.key);
	const v = utf8Encode(h.value);
	return [
		10,
		...writeVarint(k.length),
		...k,
		18,
		...writeVarint(v.length),
		...v
	];
}
/** UTF-8 编码（Node 的 Buffer 有现成实现，这里只做薄封装便于测试） */
function utf8Encode(s) {
	return Array.from(Buffer.from(s, "utf8"));
}
/**
* 解码一个 `Frame`。
*
* 未知字段**跳过**（protobuf 的前向兼容要求）：服务端加字段不该让我们崩。
*/
function decodeFrame(buf) {
	const frame = {
		SeqID: 0,
		LogID: 0,
		service: 0,
		method: 0,
		headers: []
	};
	let i = 0;
	while (i < buf.length) {
		const tag = readVarint(buf, i);
		i += tag.bytesRead;
		const fieldNo = tag.value >> 3;
		const wireType = tag.value & 7;
		if (wireType === 2) {
			const len = readVarint(buf, i);
			i += len.bytesRead;
			const start = i;
			const end = i + len.value;
			if (end > buf.length) throw new Error("长度前缀超出帧边界（帧损坏）");
			const slice = buf.subarray(start, end);
			i = end;
			switch (fieldNo) {
				case 5:
					frame.headers.push(decodeHeader(slice));
					break;
				case 6:
					frame.payloadEncoding = utf8Decode(slice);
					break;
				case 7:
					frame.payloadType = utf8Decode(slice);
					break;
				case 8:
					frame.payload = slice;
					break;
				case 9: frame.LogIDNew = utf8Decode(slice);
			}
		} else if (wireType === 0) {
			const v = readVarint(buf, i);
			i += v.bytesRead;
			switch (fieldNo) {
				case 1:
					frame.SeqID = v.value;
					break;
				case 2:
					frame.LogID = v.value;
					break;
				case 3:
					frame.service = v.value;
					break;
				case 4: frame.method = v.value;
			}
		} else if (wireType === 1) i += 8;
		else if (wireType === 5) i += 4;
		else throw new Error(`不支持的 wireType=${wireType}（field=${fieldNo}）`);
	}
	return frame;
}
function decodeHeader(buf) {
	const h = {
		key: "",
		value: ""
	};
	let i = 0;
	while (i < buf.length) {
		const tag = readVarint(buf, i);
		i += tag.bytesRead;
		const fieldNo = tag.value >> 3;
		const wireType = tag.value & 7;
		if (wireType !== 2) throw new Error(`Header 出现了非长度前缀字段（field=${fieldNo} wireType=${wireType}）`);
		const len = readVarint(buf, i);
		i += len.bytesRead;
		const end = i + len.value;
		if (end > buf.length) throw new Error("Header 长度超出边界");
		const s = utf8Decode(buf.subarray(i, end));
		i = end;
		if (fieldNo === 1) h.key = s;
		else if (fieldNo === 2) h.value = s;
	}
	return h;
}
function utf8Decode(b) {
	return Buffer.from(b).toString("utf8");
}
/** 取头字段（没有则 undefined） */
function getHeader(frame, key) {
	return frame.headers.find((h) => h.key === key)?.value;
}
/** 造一个 PING 控制帧 */
function makePingFrame(serviceId) {
	return {
		SeqID: 0,
		LogID: 0,
		service: serviceId,
		method: FrameType.control,
		headers: [{
			key: HeaderKey.type,
			value: MessageType.ping
		}]
	};
}
/** 造一个 PONG 控制帧（回应服务端 ping） */
function makePongFrame(serviceId, headers = []) {
	const carried = headers.filter((h) => h.key !== HeaderKey.type);
	return {
		SeqID: 0,
		LogID: 0,
		service: serviceId,
		method: FrameType.control,
		headers: [{
			key: HeaderKey.type,
			value: MessageType.pong
		}, ...carried]
	};
}

export { FrameType, MessageType, HeaderKey, LarkWsErrorCode, writeVarint, readVarint, encodeFrame, encodeHeader, utf8Encode, decodeFrame, decodeHeader, utf8Decode, getHeader, makePingFrame, makePongFrame };
