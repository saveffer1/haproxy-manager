import Editor from "@monaco-editor/react";
import { Loader2, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { type ComponentProps, useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
createHAProxyConfigFile,
deleteHAProxyConfigFile,
getHAProxyConfigFileContent,
type HAProxyConfigFile,
listHAProxyConfigFiles,
reloadHAProxyConfig,
saveHAProxyConfigFile,
} from "@/lib/api";
import { registerHaproxyLanguage } from "@/lib/haproxy-language";
import { cn } from "@/lib/utils";

function formatReloadMessage(autoReload: boolean) {
return autoReload
? "Saved and reloaded HAProxy successfully"
: "Saved successfully (reload skipped)";
}

function getEditorLanguage(filePath: string | null) {
if (!filePath) {
return "plaintext";
}

if (filePath.toLowerCase().endsWith(".cfg")) {
return "haproxy";
}

return "plaintext";
}

export default function HAProxyConfigEditor() {
const [files, setFiles] = useState<HAProxyConfigFile[]>([]);
const [selectedPath, setSelectedPath] = useState<string | null>(null);
const [originalContent, setOriginalContent] = useState("");
const [draftContent, setDraftContent] = useState("");
const [newFilePath, setNewFilePath] = useState("");
const [fileFilter, setFileFilter] = useState("");
const [autoReload, setAutoReload] = useState(true);
const [loadingFiles, setLoadingFiles] = useState(true);
const [loadingContent, setLoadingContent] = useState(false);
const [saving, setSaving] = useState(false);
const [reloading, setReloading] = useState(false);
const [creating, setCreating] = useState(false);
const [removing, setRemoving] = useState(false);
const [error, setError] = useState<string | null>(null);
const [notice, setNotice] = useState<string | null>(null);
const [supportsHaproxyLanguage, setSupportsHaproxyLanguage] = useState(true);

const handleEditorBeforeMount = useCallback(
	(monaco: Parameters<NonNullable<ComponentProps<typeof Editor>["beforeMount"]>>[0]) => {
		const supported = registerHaproxyLanguage(monaco);
		if (!supported) {
			setSupportsHaproxyLanguage(false);
		}
	},
	[],
);

const editorLanguage = useMemo(() => {
	if (!supportsHaproxyLanguage) {
		return selectedPath?.toLowerCase().endsWith(".cfg") ? "ini" : "plaintext";
	}

	return getEditorLanguage(selectedPath);
}, [selectedPath, supportsHaproxyLanguage]);

const isDirty = useMemo(
() => selectedPath !== null && draftContent !== originalContent,
[draftContent, originalContent, selectedPath],
);

const filteredFiles = useMemo(() => {
const query = fileFilter.trim().toLowerCase();
if (!query) {
return files;
}

return files.filter((file) => file.path.toLowerCase().includes(query));
}, [fileFilter, files]);

const clearMessages = useCallback(() => {
setError(null);
setNotice(null);
}, []);

const loadFiles = useCallback(
async (preservePath?: string | null) => {
setLoadingFiles(true);
clearMessages();
try {
const nextFiles = await listHAProxyConfigFiles();
setFiles(nextFiles);

if (nextFiles.length === 0) {
setSelectedPath(null);
setOriginalContent("");
setDraftContent("");
return;
}

const preferredPath = preservePath === undefined ? selectedPath : preservePath;
const firstFile = nextFiles[0];
if (!firstFile) {
setSelectedPath(null);
setOriginalContent("");
setDraftContent("");
return;
}

const target =
(preferredPath &&
nextFiles.find((file) => file.path === preferredPath)?.path) ||
firstFile.path;
setSelectedPath(target);
} catch (loadError) {
setError(
loadError instanceof Error
? loadError.message
: "Failed to load config files",
);
} finally {
setLoadingFiles(false);
}
},
[clearMessages, selectedPath],
);

useEffect(() => {
void loadFiles();
}, [loadFiles]);

useEffect(() => {
if (!selectedPath) {
return;
}

let active = true;
setLoadingContent(true);
clearMessages();

getHAProxyConfigFileContent(selectedPath)
.then((content) => {
if (!active) {
return;
}
setOriginalContent(content);
setDraftContent(content);
})
.catch((contentError) => {
if (!active) {
return;
}
setError(
contentError instanceof Error
? contentError.message
: "Failed to load config content",
);
})
.finally(() => {
if (active) {
setLoadingContent(false);
}
});

return () => {
active = false;
};
}, [clearMessages, selectedPath]);

const handleSave = useCallback(async () => {
if (!selectedPath || !isDirty) {
return;
}

setSaving(true);
clearMessages();
try {
await saveHAProxyConfigFile(selectedPath, draftContent, autoReload);
setOriginalContent(draftContent);
setNotice(formatReloadMessage(autoReload));
await loadFiles(selectedPath);
} catch (saveError) {
setError(
saveError instanceof Error
? saveError.message
: "Failed to save config file",
);
} finally {
setSaving(false);
}
}, [
autoReload,
clearMessages,
draftContent,
isDirty,
loadFiles,
selectedPath,
]);

const handleCreateFile = useCallback(async () => {
const normalizedPath = newFilePath.trim();
if (!normalizedPath) {
setError("Please provide a file path, e.g. service/api.cfg");
return;
}

setCreating(true);
clearMessages();
try {
await createHAProxyConfigFile(normalizedPath, "", false);
setNewFilePath("");
setNotice("Config file created");
await loadFiles(normalizedPath);
} catch (createError) {
setError(
createError instanceof Error
? createError.message
: "Failed to create config file",
);
} finally {
setCreating(false);
}
}, [clearMessages, loadFiles, newFilePath]);

const handleDelete = useCallback(async () => {
if (!selectedPath) {
return;
}

const confirmed = window.confirm(`Delete ${selectedPath}?`);
if (!confirmed) {
return;
}

setRemoving(true);
clearMessages();
try {
await deleteHAProxyConfigFile(selectedPath, autoReload);
setNotice(
autoReload
? "Config file deleted and HAProxy reloaded"
: "Config file deleted",
);
await loadFiles(null);
} catch (deleteError) {
setError(
deleteError instanceof Error
? deleteError.message
: "Failed to delete config file",
);
} finally {
setRemoving(false);
}
}, [autoReload, clearMessages, loadFiles, selectedPath]);

const handleManualReload = useCallback(async () => {
setReloading(true);
clearMessages();
try {
await reloadHAProxyConfig();
setNotice("HAProxy reload requested successfully");
} catch (reloadError) {
setError(
reloadError instanceof Error
? reloadError.message
: "Failed to reload HAProxy",
);
} finally {
setReloading(false);
}
}, [clearMessages]);

return (
<Card className="border-border/70">
<CardHeader className="space-y-4">
<div className="flex flex-wrap items-center justify-between gap-3">
<div>
<CardTitle>HAProxy Config Editor</CardTitle>
<p className="mt-1 text-sm text-muted-foreground">
Manage every file inside conf.d with Monaco.
</p>
</div>
<div className="flex items-center gap-2">
<Button
variant="outline"
onClick={handleManualReload}
disabled={reloading}
>
{reloading ? (
<Loader2 className="h-4 w-4 animate-spin" />
) : (
<RefreshCw className="h-4 w-4" />
)}
Reload HAProxy
</Button>
</div>
</div>

<div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
<Input
placeholder="new-service.cfg or nested/path/service.cfg"
value={newFilePath}
onChange={(event) => setNewFilePath(event.target.value)}
/>
<Button onClick={handleCreateFile} disabled={creating}>
{creating ? (
<Loader2 className="h-4 w-4 animate-spin" />
) : (
<Plus className="h-4 w-4" />
)}
Create File
</Button>
</div>
</CardHeader>
<CardContent className="space-y-4">
<div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
<Input
placeholder="Filter config files..."
value={fileFilter}
onChange={(event) => setFileFilter(event.target.value)}
/>
<p className="flex items-center justify-end text-sm text-muted-foreground">
{filteredFiles.length} / {files.length} files
</p>
</div>

<div className="flex flex-wrap items-center justify-between gap-2">
<label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
<input
type="checkbox"
checked={autoReload}
onChange={(event) => setAutoReload(event.target.checked)}
className="h-4 w-4 rounded border-border"
/>
Auto reload after save/delete
</label>
<div className="flex items-center gap-2">
<Button
variant="destructive"
onClick={handleDelete}
disabled={!selectedPath || removing}
>
{removing ? (
<Loader2 className="h-4 w-4 animate-spin" />
) : (
<Trash2 className="h-4 w-4" />
)}
Delete
</Button>
<Button
onClick={handleSave}
disabled={!isDirty || saving || loadingContent}
>
{saving ? (
<Loader2 className="h-4 w-4 animate-spin" />
) : (
<Save className="h-4 w-4" />
)}
Save
</Button>
</div>
</div>

{error && (
<div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
{error}
</div>
)}

{notice && (
<div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
{notice}
</div>
)}

<div className="grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
<div className="overflow-hidden rounded-lg border border-border bg-muted/20">
{loadingFiles ? (
<div className="flex h-[60vh] items-center justify-center text-sm text-muted-foreground">
Loading files...
</div>
) : filteredFiles.length === 0 ? (
<div className="flex h-[60vh] items-center justify-center px-3 text-center text-sm text-muted-foreground">
No files match your search
</div>
) : (
<div className="h-[60vh] overflow-y-auto p-2">
{filteredFiles.map((file) => (
<button
key={file.path}
type="button"
onClick={() => setSelectedPath(file.path)}
className={cn(
"mb-1 block w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
selectedPath === file.path
? "border-primary bg-primary/10 text-primary"
: "border-border bg-background text-muted-foreground hover:text-foreground",
)}
>
{file.path}
</button>
))}
</div>
)}
</div>

<div className="overflow-hidden rounded-lg border border-border">
{loadingContent ? (
<div className="flex h-[60vh] items-center justify-center bg-card text-sm text-muted-foreground">
<Loader2 className="mr-2 h-4 w-4 animate-spin" />
Loading editor...
</div>
) : (
<Editor
height="60vh"
path={selectedPath ?? undefined}
language={editorLanguage}
beforeMount={handleEditorBeforeMount}
theme="vs-dark"
value={draftContent}
onChange={(value) => setDraftContent(value ?? "")}
options={{
fontSize: 13,
minimap: { enabled: false },
automaticLayout: true,
tabSize: 2,
wordWrap: "on",
scrollBeyondLastLine: false,
}}
/>
)}
</div>
</div>
</CardContent>
</Card>
);
}
