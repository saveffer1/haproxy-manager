import type * as monacoEditor from "monaco-editor";

const LANGUAGE_ID = "haproxy";

const KEYWORDS = [
	"accepted_payload_size",
	"acl",
	"appsession",
	"backlog",
	"balance",
	"bind",
	"bind-process",
	"block",
	"ca-base",
	"chroot",
	"compression",
	"cookie",
	"cpu-map",
	"crt-base",
	"daemon",
	"default-server",
	"default_backend",
	"description",
	"disabled",
	"dispatch",
	"enabled",
	"errorfile",
	"errorloc",
	"errorloc302",
	"errorloc303",
	"force-persist",
	"from",
	"fullconn",
	"grace",
	"hash-type",
	"hold",
	"id",
	"ignore-persist",
	"lua-load",
	"log-format",
	"log",
	"mode",
	"monitor",
	"monitor-net",
	"monitor-uri",
	"nameserver",
	"nbproc",
	"peer",
	"persist",
	"rate-limit",
	"redirect",
	"reqadd",
	"reqallow",
	"reqdel",
	"reqdeny",
	"reqiallow",
	"reqidel",
	"reqideny",
	"reqipass",
	"reqirep",
	"reqisetbe",
	"reqitarpit",
	"reqpass",
	"reqrep",
	"reqsetbe",
	"reqtarpit",
	"resolution_pool_size",
	"resolve_retries",
	"retries",
	"rspadd",
	"rspdel",
	"rspdeny",
	"rspidel",
	"rspideny",
	"rspirep",
	"rsprep",
	"server",
	"source",
	"ssl-default-bind-ciphers",
	"ssl-default-bind-options",
	"timeout",
	"to",
	"unique-id-format",
	"unique-id-header",
	"use_backend",
	"use-server",
];

const SECTION_KEYWORDS = [
	"aggregations",
	"backend",
	"defaults",
	"frontend",
	"global",
	"listen",
	"peers",
	"resolvers",
	"userlist",
];

const STICK_TABLE_PARAMS = [
	"key",
	"server_id",
	"gpc0",
	"gpc0_rate",
	"gpc1",
	"gpc1_rate",
	"conn_cnt",
	"conn_cur",
	"conn_rate",
	"sess_cnt",
	"sess_rate",
	"http_req_cnt",
	"http_req_rate",
	"http_err_cnt",
	"http_err_rate",
	"bytes_in_cnt",
	"bytes_in_rate",
	"bytes_out_cnt",
	"bytes_out_rate",
];

const SUB_KEYWORDS = [
	"add-header",
	"admin",
	"append-slash",
	"backup",
	"ca-file",
	"check",
	"code",
	"connect",
	"crt",
	"debug",
	"del-header",
	"drop-query",
	"error-limit",
	"found",
	"group",
	"http",
	"https",
	"insecure-password",
	"len",
	"level",
	"maxconn",
	"mark-down",
	"notice",
	"no-sslv3",
	"nx",
	"obsolete",
	"on-error",
	"on-marked-up",
	"optional",
	"origin",
	"other",
	"path_beg",
	"port",
	"prefix",
	"refused",
	"resolve",
	"retry",
	"rise",
	"roundrobin",
	"scheme",
	"set-header",
	"shutdown-backup-sessions",
	"ssl",
	"status",
	"tcp",
	"timeout",
	"tune",
	"use-service",
	"user",
	"valid",
	"verify",
];

function escapeRegexValue(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SECTION_LINE_REGEX = new RegExp(
	`^(?:\\s*)(?:${SECTION_KEYWORDS.map(escapeRegexValue).join("|")})\\b`,
);

export function registerHaproxyLanguage(monaco: typeof monacoEditor) {
	try {
		const alreadyRegistered = monaco.languages
			.getLanguages()
			.some((language) => language.id === LANGUAGE_ID);

		if (!alreadyRegistered) {
			monaco.languages.register({
				id: LANGUAGE_ID,
				extensions: [".cfg", ".haproxy.cfg"],
				aliases: ["HAProxy", "haproxy"],
			});
		}

		monaco.languages.setLanguageConfiguration(LANGUAGE_ID, {
			comments: {
				lineComment: "#",
			},
			brackets: [
				["{", "}"],
				["[", "]"],
				["(", ")"],
			],
			autoClosingPairs: [
				{ open: "{", close: "}" },
				{ open: "[", close: "]" },
				{ open: "(", close: ")" },
				{ open: '"', close: '"' },
				{ open: "'", close: "'" },
			],
			surroundingPairs: [
				{ open: "{", close: "}" },
				{ open: "[", close: "]" },
				{ open: "(", close: ")" },
				{ open: '"', close: '"' },
				{ open: "'", close: "'" },
			],
		});

		monaco.languages.setMonarchTokensProvider(LANGUAGE_ID, {
			ignoreCase: true,
			keywords: KEYWORDS,
			stickParams: STICK_TABLE_PARAMS,
			subKeywords: SUB_KEYWORDS,
			tokenizer: {
				root: [
					[/#.*/, "comment"],
					[
						/\b(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?):\d{1,5}\b/,
						"number",
					],
					[/\*:\d{1,5}\b/, "number"],
					[/\bciphers\s+[^\s#]+/, "string"],
					[/\b(?:\d+|\d+s)\b/, "number"],
					[SECTION_LINE_REGEX, "type"],
					[
						/\b(?:capture\s+(?:cookie|request\s+header|response\s+header))\b/,
						"keyword",
					],
					[
						/\b(?:http-check\s+(?:disable-on-404|expect|send-state)|http-(?:request|response))\b/,
						"keyword",
					],
					[
						/\b(?:option\s+(?:abortonclose|accept-invalid-http-request|accept-invalid-http-response|allbackups|checkcache|clitcpka|contstats|dontlog-normal|dontlognull|forceclose|forwardfor|http-no-delay|http-pretend-keepalive|http-server-close|http-use-proxy-header|httpchk|httpclose|httplog|http_proxy|independent-streams|ldap-check|log-health-checks|log-separate-errors|logasap|mysql-check|pgsql-check|nolinger|originalto|persist|redispatch|redis-check|smtpchk|socket-stats|splice-auto|splice-request|splice-response|srvtcpka|ssl-hello-chk|tcp-check|tcp-smart-accept|tcp-smart-connect|tcpka|tcplog|transparent))\b/,
						"keyword",
					],
					[
						/\b(?:stats\s+(?:admin|auth|bind-process|enable|hide-version|http-request|realm|refresh|scope|show-desc|show-legends|show-node|socket|timeout|uri))\b/,
						"keyword",
					],
					[
						/\b(?:stick\s+(?:match|on|store-request|store-response)|stick-table)\b/,
						"keyword",
					],
					[
						/\b(?:tcp-request\s+(?:connection|content|inspect-delay)|tcp-response\s+(?:content|inspect-delay))\b/,
						"keyword",
					],
					[
						/\b(?:timeout\s+(?:check|client|connect|http-keep-alive|http-request|queue|server|tarpit|tunnel))\b/,
						"keyword",
					],
					[
						/\b(?:add-(?:header|acl|map|var)|del-(?:acl|header|map|var)|set-(?:header|nice|log-level|path|query|uri|tos|mark|priority-classs|priority-offset|var)|replace-(?:header|value))\b/,
						"predefined",
					],
					[/\b(?:status|rstatus|rstring|string)\s+.+$/, "string"],
					[/\b(?:if|unless|rewrite)\b/, "keyword"],
					[/\s+(?:or|\|\||!)\s+/, "operator"],
					[/%\[[^\]]+\]/, "variable"],
					[/\b(?:capture\.(?:req|res)\.hdr|http_auth)\b/, "function"],
					[/\/[-\w.?=]+/, "variable"],
					[/"(?:\\.|[^"])*"/, "string"],
					[/^\s*(?:maxconn|user|group)\b/, "keyword"],
					[
						/\b[\w-]+\b/,
						{
							cases: {
								"@stickParams": "constant",
								"@keywords": "keyword",
								"@subKeywords": "predefined",
								"@default": "identifier",
							},
						},
					],
				],
			},
		});

		return true;
	} catch (error) {
		console.error("Failed to register Monaco HAProxy language", error);
		return false;
	}
}
