// @ts-nocheck
// 由 10/18 打包产物还原（chunk: FlowRuntime-LedUoDmO.js）；见 _recovery/README-recovery.md
import * as fs from "fs";
import * as fs_promises from "fs/promises";
import * as crypto from "crypto";

/** 官方规定的 `md5_10m` 取样长度（前 10MB+ 一点，来自官方文档的取值） */
var MD5_10M_BYTES = 10002432;
/**
* 这个来源是**本地文件**还是 http(s) 直链？
*
* 判断顺序很重要：**先看协议**。`http(s)://` 一律当远程 ——
* 哪怕本机恰好存在同名文件也不行（那会把一个 URL 当路径读到别的东西）。
*
* `file://` 前缀按本地路径处理（用户从浏览器/资源管理器复制来的路径就是这种）。
* 不存在的路径返回 false：否则官方会拿一个拉不到的地址去转存。
*/
function isLocalFileSource(raw) {
	const s = String(raw ?? "").trim();
	if (!s) return false;
	if (/^https?:\/\//i.test(s)) return false;
	const path = s.startsWith("file://") ? s.slice(7) : s;
	try {
		return (0, fs.existsSync)(decodeURIComponent(path));
	} catch {
		return false;
	}
}
/**
* 算分片上传需要的三个校验值。
*
* 用**流式**读而不是 `readFile` 整个读进来：上传的文件可能有几百 MB，
* 一次性读进内存会把主进程顶爆（Electron 主进程内存很敏感）。
* 同时维护两个 md5（整文件 + 前 10MB）与一个 sha1，一遍读完。
*/
async function computeFileDigests(filePath) {
	const info = await (0, fs_promises.stat)(filePath).catch(() => null);
	if (!info) throw new Error(`文件不存在: ${filePath}`);
	if (!info.isFile()) throw new Error(`不是文件（可能是目录）: ${filePath}`);
	const md5 = (0, crypto.createHash)("md5");
	const md5_10m = (0, crypto.createHash)("md5");
	const sha1 = (0, crypto.createHash)("sha1");
	let read = 0;
	let sampled = 0;
	const handle = await (0, fs_promises.open)(filePath, "r");
	try {
		const buf = Buffer.alloc(1048576);
		for (;;) {
			const { bytesRead } = await handle.read(buf, 0, buf.length, read);
			if (bytesRead <= 0) break;
			const chunk = buf.subarray(0, bytesRead);
			md5.update(chunk);
			sha1.update(chunk);
			if (sampled < 10002432) {
				const take = Math.min(bytesRead, MD5_10M_BYTES - sampled);
				md5_10m.update(chunk.subarray(0, take));
				sampled += take;
			}
			read += bytesRead;
		}
	} finally {
		await handle.close();
	}
	return {
		size: read,
		md5: md5.digest("hex"),
		md5_10m: md5_10m.digest("hex"),
		sha1: sha1.digest("hex")
	};
}
/**
* 媒体段类型 → 官方富媒体 file_type。
*
* 官方只有四个取值：**1 图片 / 2 视频 / 3 语音 / 4 文件**。
* 网关侧同一件事有两个名字（`record` 与 `voice` 都是语音），这里一并收掉 ——
* 漏了 `voice` 的话语音段会被判成"无法映射"而进 `unsupported`（用户看到"语音发不出去"）。
*
* 认不出的类型返回 `null`，由调用方明确报错，**不猜**（猜成图片会发出一个打不开的文件）。
*/
function mediaFileTypeOf(segmentType) {
	switch (String(segmentType ?? "").trim()) {
		case "image": return 1;
		case "video": return 2;
		case "record":
		case "voice": return 3;
		case "file": return 4;
		default: return null;
	}
}
/**
* 归一化「预上传」响应里的 `parts[]`。
*
* 官方把 `index` / `block_size` 作为**字符串**返回，直接拿去算偏移会得到
* `'0' * 10485760` 这种隐式转换的结果（可能是 NaN）。所以统一转数字。
*
* 过滤掉没有 `presigned_url` 的项：否则会 PUT 到一个空地址，
* 而且 PUT 空地址有可能**返回 200**，问题要等到合并才暴露。
*/
function normalizeUploadParts(raw) {
	if (!Array.isArray(raw)) return [];
	return raw.filter((x) => Boolean(x) && typeof x === "object").map((p) => ({
		index: Number(p.index) || 0,
		presignedUrl: String(p.presigned_url ?? ""),
		blockSize: Number(p.block_size) || 0
	})).filter((p) => p.presignedUrl).sort((a, b) => a.index - b.index);
}
/**
* 第 `seq` 片（**排序后的序号**）在文件里的字节范围。
*
* ## 为什么入参是"序号"而不是服务端的 `part.index`
*
* 真机事故：偏移量原先按服务端的 `part.index` 算。官方文档写「分片序号，从 0 开始」，
* 但**实测返回的是 1 起**（预签名 URL 路径也是 `part_1`）。于是单片文件算出
* `start = 1 * blockSize = 文件大小` → **切出长度 0 的空分片** → PUT 返回 200、
* 分片通知也返回 200，**最后合并才报 `850019 富媒体文件格式不支持`**。
*
* 这种"每一步都成功、最后一步才炸"的 bug 最容易被误判成"接口没开通"。
* 按排序后的序号算偏移，对 0 起 / 1 起都成立。
*
* `length` 永远不为负（越界序号给 0），否则 `Buffer.subarray` 会得到意外结果。
*/
/** 官方硬上限 200MB：超了本地直接拦，别让用户等到合并阶段才失败 */
var MAX_UPLOAD_BYTES = 209715200;
/** 分片 PUT 的 Content-Type —— 与 file_type 对齐（实测缺了它字节能上去、但后端可能认不出格式） */
function contentTypeOf(fileType) {
	return {
		1: "image/png",
		2: "video/mp4",
		3: "application/octet-stream",
		4: "application/octet-stream"
	}[fileType] ?? "application/octet-stream";
}
/** 默认的区间读取：只读那一段，不把整个文件读进内存 */
async function defaultReadRange(filePath, start, endExclusive) {
	const handle = await (0, fs_promises.open)(filePath, "r");
	try {
		const len = Math.max(0, endExclusive - start);
		const buf = Buffer.alloc(len);
		let done = 0;
		while (done < len) {
			const { bytesRead } = await handle.read(buf, done, len - done, start + done);
			if (bytesRead <= 0) break;
			done += bytesRead;
		}
		return buf.subarray(0, done);
	} finally {
		await handle.close();
	}
}
/** 分片完成的路径参数（与预上传同形；文档里的占位符名不一致，但实际 URL 形状一致） */
function uploadEndpoints(base, chatType, chatId) {
	const scope = chatType === "c2c" ? "users" : "groups";
	return {
		prepare: `${base}/v2/${scope}/${chatId}/upload_prepare`,
		partFinish: `${base}/v2/${scope}/${chatId}/upload_part_finish`,
		merge: `${base}/v2/${scope}/${chatId}/files`
	};
}
/**
* 本地文件 → 官方富媒体（四步分片上传）。
*
* 官方推荐这条路径，也是**本地文件唯一能发出去的路**：URL 上传要求来源是平台可访问的
* http(s) 直链（由 QQ 服务端去拉取转存），机器人所在机器上的文件它拉不到。
*/
async function uploadLocalFileByParts(client, opts) {
	const readRange = client.readRange ?? defaultReadRange;
	const doFetch = client.plainFetch ?? globalThis.fetch;
	const ep = uploadEndpoints(client.base, opts.chatType, opts.chatId);
	let digests;
	try {
		digests = await computeFileDigests(opts.filePath);
	} catch (e) {
		return {
			ok: false,
			error: `读取文件失败: ${e instanceof Error ? e.message : String(e)}`
		};
	}
	if (digests.size > 209715200) return {
		ok: false,
		error: `文件 ${(digests.size / 1024 / 1024).toFixed(1)}MB 超过官方上限 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB`
	};
	const fileName = opts.fileName?.trim() || opts.filePath.split(/[\\/]/).pop() || `upload.${opts.fileType}`;
	let prep;
	try {
		const res = await client.authFetch(ep.prepare, {
			method: "POST",
			body: JSON.stringify({
				file_type: opts.fileType,
				file_size: String(digests.size),
				file_name: fileName,
				md5: digests.md5,
				sha1: digests.sha1,
				md5_10m: digests.md5_10m
			})
		});
		prep = await res.json().catch(() => ({}));
		if (!res.ok) return {
			ok: false,
			error: `预上传失败（HTTP ${res.status}）: ${JSON.stringify(prep).slice(0, 200)}`
		};
	} catch (e) {
		return {
			ok: false,
			error: `预上传异常: ${e instanceof Error ? e.message : String(e)}`
		};
	}
	const uploadId = String(prep.upload_id ?? "");
	const parts = normalizeUploadParts(prep.parts);
	if (!uploadId || !parts.length) return {
		ok: false,
		error: "预上传响应缺少 upload_id 或 parts（官方契约可能变了）"
	};
	const cfg = prep.upload_config ?? {};
	const retryDelayMs = Math.max(0, Number(cfg.retry_delay ?? 1)) * 1e3;
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		const range = partByteRange(i, part.blockSize, digests.size);
		if (range.length <= 0) return {
			ok: false,
			error: `第 ${i + 1} 片为空（start=${range.start}，文件 ${digests.size} 字节）—— 分片边界算错了`
		};
		let chunk;
		try {
			chunk = await readRange(opts.filePath, range.start, range.start + range.length);
		} catch (e) {
			return {
				ok: false,
				error: `读取第 ${i + 1} 片失败: ${e instanceof Error ? e.message : String(e)}`
			};
		}
		const partMd5 = (0, crypto.createHash)("md5").update(chunk).digest("hex");
		try {
			const putRes = await doFetch(part.presignedUrl, {
				method: "PUT",
				headers: { "Content-Type": contentTypeOf(opts.fileType) },
				body: new Uint8Array(chunk)
			});
			if (!putRes.ok) return {
				ok: false,
				error: `第 ${i + 1} 片直传失败（HTTP ${putRes.status}）`
			};
			const finRes = await client.authFetch(ep.partFinish, {
				method: "POST",
				body: JSON.stringify({
					upload_id: uploadId,
					part_index: part.index,
					block_size: String(part.blockSize),
					md5: partMd5
				})
			});
			if (!finRes.ok) {
				const txt = await finRes.text().catch(() => "");
				return {
					ok: false,
					error: `第 ${i + 1} 片完成通知失败（HTTP ${finRes.status}）: ${txt.slice(0, 200)}`
				};
			}
		} catch (e) {
			return {
				ok: false,
				error: `第 ${i + 1} 片上传异常: ${e instanceof Error ? e.message : String(e)}`
			};
		}
		if (retryDelayMs) await new Promise((r) => setTimeout(r, 0));
	}
	try {
		const res = await client.authFetch(ep.merge, {
			method: "POST",
			body: JSON.stringify({
				file_type: opts.fileType,
				srv_send_msg: false,
				file_name: fileName,
				upload_id: uploadId
			})
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) return {
			ok: false,
			error: `合并失败（HTTP ${res.status}）: ${JSON.stringify(data).slice(0, 200)}`
		};
		return {
			ok: true,
			fileInfo: String(data.file_info ?? ""),
			fileUuid: String(data.file_uuid ?? ""),
			ttl: Number(data.ttl ?? 0),
			partCount: parts.length
		};
	} catch (e) {
		return {
			ok: false,
			error: `合并异常: ${e instanceof Error ? e.message : String(e)}`
		};
	}
}
function partByteRange(seq, blockSize, totalSize) {
	const start = Math.max(0, seq) * Math.max(0, blockSize);
	return {
		start,
		length: Math.max(0, Math.min(Math.max(0, blockSize), totalSize - start))
	};
}

export { MD5_10M_BYTES, isLocalFileSource, computeFileDigests, mediaFileTypeOf, normalizeUploadParts, MAX_UPLOAD_BYTES, contentTypeOf, defaultReadRange, uploadEndpoints, uploadLocalFileByParts, partByteRange };
