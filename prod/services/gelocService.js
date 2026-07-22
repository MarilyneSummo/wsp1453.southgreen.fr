const { execFile } = require("child_process");
const path = require("path");
const { logToFile } = require("../utils/logger");
const nodemailer = require("nodemailer");
const { log } = require("console");

const TABIX_BIN = "/opt/htslib/bin/tabix";
const GFF_BASE_DIR = "/opt/www/geloc.southgreen.fr/prod";
const FEEDBACK_FROM = process.env.GELOC_FEEDBACK_FROM || "marilyne.summo@cirad.fr";
const FEEDBACK_TO = process.env.GELOC_FEEDBACK_TO || "marilyne.summo@cirad.fr";

const mailTransporter = nodemailer.createTransport({
	host: "smtp.cirad.fr",
	port: 25,
	secure: false,
	tls: { rejectUnauthorized: true },
});

const VALID_CHRNUM_RE = /^\d{1,3}$/;
const VALID_COORD_RE = /^\d{1,12}$/;
const VALID_RELEASE_RE = /^[A-Za-z0-9._-]+$/;
const VALID_ACC_RE = /^[A-Za-z0-9_.-]{1,50}$/;
const VALID_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MAX_RESPONSE_LINES = 50000;

const rateLimits = new Map();
function checkRate(socketId, max = 200, windowMs = 60000) {
	const now = Date.now();
	const entry = rateLimits.get(socketId);
	if (!entry || now > entry.resetTime) {
		rateLimits.set(socketId, { count: 1, resetTime: now + windowMs });
		return true;
	}
	entry.count++;
	if (entry.count > max) {
		return false;
	}
	return true;
}

function sanitizeFilename(s) {
	return String(s).replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 100);
}

function validateRunArgs(args) {
	const callback = args[args.length - 1];
	if (typeof callback !== "function") {
		return { error: "missing callback" };
	}

	if (args.length >= 5) {
		const release = args[0];
		const acc = args[1];
		const chrnum = args[2];
		const from = args[3];
		const to = args[4];

		if (!VALID_RELEASE_RE.test(String(release))) {
			return { error: "invalid release", callback };
		}
		if (!VALID_ACC_RE.test(String(acc))) {
			return { error: "invalid acc", callback };
		}
		if (!VALID_CHRNUM_RE.test(String(chrnum))) {
			return { error: "invalid chrnum", callback };
		}
		if (!VALID_COORD_RE.test(String(from).replace(/ /g, ""))) {
			return { error: "invalid from", callback };
		}
		if (!VALID_COORD_RE.test(String(to).replace(/ /g, ""))) {
			return { error: "invalid to", callback };
		}

		let gffPath;
		try {
			gffPath = resolveGffPath(release, acc);
		} catch (e) {
			return { error: e.message, callback };
		}
		return { callback, gffPath, chrnum: String(chrnum), from: String(from).replace(/ /g, ""), to: String(to).replace(/ /g, "") };
	}

	if (args.length >= 4) {
		const gffPath = args[0];
		const chrnum = args[1];
		const from = args[2];
		const to = args[3];

		if (typeof gffPath !== "string" || !gffPath.endsWith(".gz")) {
			return { error: "invalid gffPath", callback };
		}
		const resolved = path.resolve(gffPath);
		if (!resolved.startsWith("/opt/www/") || resolved.includes("..")) {
			return { error: "path traversal blocked", callback };
		}
		if (!VALID_CHRNUM_RE.test(String(chrnum))) {
			return { error: "invalid chrnum", callback };
		}
		if (!VALID_COORD_RE.test(String(from).replace(/ /g, ""))) {
			return { error: "invalid from", callback };
		}
		if (!VALID_COORD_RE.test(String(to).replace(/ /g, ""))) {
			return { error: "invalid to", callback };
		}

		return { callback, gffPath: resolved, chrnum: String(chrnum), from: String(from).replace(/ /g, ""), to: String(to).replace(/ /g, "") };
	}

	return { error: "unexpected args count", callback: typeof callback === "function" ? callback : null };
}

function runTabix(gffPath, chrnum, from, to, callback) {
	const region = `Chr${chrnum}:${from}-${to}`;
	const altRegion = `${chrnum}:${from}-${to}`;

	logToFile(`tabix ${gffPath} ${region}`);

	execFile(TABIX_BIN, [gffPath, region], (error, stdout, stderr) => {
		if (error) {
			logToFile(`tabix error: ${error.message}`);
		}
		if (stdout) {
			const lines = stdout.split("\n");
			if (lines.length > MAX_RESPONSE_LINES) {
				return callback(null, lines.slice(0, MAX_RESPONSE_LINES).join("\n"));
			}
			return callback(null, stdout);
		}
		logToFile(`No result with Chr prefix, retrying: tabix ${gffPath} ${altRegion}`);
		execFile(TABIX_BIN, [gffPath, altRegion], (err2, stdout2) => {
			if (err2) {
				logToFile(`tabix fallback error: ${err2.message}`);
			}
			if (stdout2) {
				const lines = stdout2.split("\n");
				if (lines.length > MAX_RESPONSE_LINES) {
					return callback(null, lines.slice(0, MAX_RESPONSE_LINES).join("\n"));
				}
			}
			callback(null, stdout2 || "");
		});
	});
}

function resolveGffPath(arg1, arg2) {
	const release = String(arg1);
	const acc = String(arg2);

	const gffPath = path.join(GFF_BASE_DIR, `data_${release}`, "gff", `LRR_${acc}.gff.gz`);
	const resolved = path.resolve(gffPath);

	if (!resolved.startsWith(GFF_BASE_DIR) || resolved.includes("..")) {
		throw new Error("Path traversal detected");
	}

	return resolved;
}

function escapeHtml(str) {
	return String(str)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

module.exports = {
	attachHandlers(socket) {
		socket.on("geloc_run", (...args) => {
			log(`geloc run called with ${args.length} arguments`, socket.id);

			if (!checkRate(socket.id)) {
				logToFile("geloc run: rate limit exceeded", socket.id);
				const callback = args[args.length - 1];
				if (typeof callback === "function") {
					callback("Rate limit exceeded", null);
				}
				return;
			}

			const result = validateRunArgs(args);
			if (result.error) {
				logToFile(`geloc run: ${result.error}`, socket.id);
				if (typeof result.callback === "function") {
					result.callback(result.error, null);
				}
				return;
			}

			const { callback, gffPath, chrnum, from, to } = result;
			logToFile(`geloc run: gffPath=${gffPath} region=Chr${chrnum}:${from}-${to}`, socket.id);
			runTabix(gffPath, chrnum, from, to, callback);
		});

		socket.on("feedback", (email, xp, data, callback) => {
			logToFile(`geloc feedback from ${email}`, socket.id);

			if (!checkRate(socket.id, 10, 60000)) {
				logToFile("geloc feedback: rate limit exceeded", socket.id);
				if (typeof callback === "function") {
					callback("Rate limit exceeded", null);
				}
				return;
			}

			const safeEmail = typeof email === "string" && VALID_EMAIL_RE.test(email) ? email : "unknown";
			const safeXp = escapeHtml(xp);
			const safeData = escapeHtml(data);

			mailTransporter.sendMail(
				{
					from: FEEDBACK_FROM,
					to: FEEDBACK_TO,
					subject: "GeLoc feedback",
					text: `Message from: ${safeEmail}\n${safeXp}\nMessage:\n${safeData}`,
				},
				(err, info) => {
					if (err) {
						logToFile(`geloc feedback error: ${err.message}`, socket.id);
					} else {
						logToFile(`geloc feedback sent: ${info.response}`, socket.id);
					}
					if (typeof callback === "function") {
						callback(null, data);
					}
				},
			);
		});

		logToFile("Geloc handlers attached", socket.id);
	},
};
