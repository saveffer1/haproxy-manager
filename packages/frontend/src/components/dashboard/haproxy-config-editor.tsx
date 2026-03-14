import Editor from "@monaco-editor/react";
import { Loader2, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import {
	type ComponentProps,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
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

type HAProxyConfigEditorProps = {
	selectedNodeId: string | null;
	selectedNodeName: string | null;
	selectedNodeConfigPath: string | null;
};

const NODE_SELECTION_DEBOUNCE_MS = 250;

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

export default function HAProxyConfigEditor({
	selectedNodeId,
	selectedNodeName,
	selectedNodeConfigPath,
}: HAProxyConfigEditorProps) {
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
	const [lastSaveFailed, setLastSaveFailed] = useState(false);
	const [supportsHaproxyLanguage, setSupportsHaproxyLanguage] = useState(true);
	const [debouncedNodeId, setDebouncedNodeId] = useState<string | null>(
		selectedNodeId,
	);
	const fileRequestSequenceRef = useRef(0);
	const contentRequestSequenceRef = useRef(0);
	const configuredRootPath = selectedNodeConfigPath?.trim() ?? "";
	const hasConfiguredRootPath = configuredRootPath.length > 0;
	const isNodeSwitching = selectedNodeId !== debouncedNodeId;
	const canManageNodeConfig =
		Boolean(debouncedNodeId) && hasConfiguredRootPath && !isNodeSwitching;

	useEffect(() => {
		const debounceTimer = setTimeout(() => {
			setDebouncedNodeId(selectedNodeId);
		}, NODE_SELECTION_DEBOUNCE_MS);

		return () => {
			clearTimeout(debounceTimer);
		};
	}, [selectedNodeId]);

	const handleEditorBeforeMount = useCallback(
		(
			monaco: Parameters<
				NonNullable<ComponentProps<typeof Editor>["beforeMount"]>
			>[0],
		) => {
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

	const reloadBlockedReason = useMemo(() => {
		if (isDirty) {
			return "Unsaved changes detected. Save or discard changes before reload.";
		}

		if (saving || creating || removing || loadingFiles || loadingContent) {
			return "Please wait for file operations to finish before reload.";
		}

		if (lastSaveFailed) {
			return "Last save attempt failed. Fix configuration and save successfully before reload.";
		}

		return null;
	}, [
		creating,
		isDirty,
		lastSaveFailed,
		loadingContent,
		loadingFiles,
		removing,
		saving,
	]);

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

	useEffect(() => {
		// Prevent stale file path lookups when changing selected node.
		if (selectedNodeId === null && !canManageNodeConfig) {
			setSelectedPath(null);
			setOriginalContent("");
			setDraftContent("");
			setLastSaveFailed(false);
			clearMessages();
			return;
		}

		setSelectedPath(null);
		setOriginalContent("");
		setDraftContent("");
		setLastSaveFailed(false);
		clearMessages();
	}, [canManageNodeConfig, clearMessages, selectedNodeId]);

	const loadFiles = useCallback(
		async (
			preservePath?: string | null,
			options?: {
				forceRefresh?: boolean;
			},
		) => {
			if (!canManageNodeConfig) {
				fileRequestSequenceRef.current += 1;
				setFiles([]);
				setSelectedPath(null);
				setOriginalContent("");
				setDraftContent("");
				setLoadingFiles(false);
				return;
			}

			if (!debouncedNodeId) {
				return;
			}

			const requestSequence = ++fileRequestSequenceRef.current;

			setLoadingFiles(true);
			clearMessages();
			try {
				const nextFiles = await listHAProxyConfigFiles(debouncedNodeId, {
					forceRefresh: options?.forceRefresh,
				});
				if (requestSequence !== fileRequestSequenceRef.current) {
					return;
				}
				setFiles(nextFiles);

				if (nextFiles.length === 0) {
					setSelectedPath(null);
					setOriginalContent("");
					setDraftContent("");
					return;
				}

				const preferredPath =
					preservePath === undefined ? selectedPath : preservePath;
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
				if (requestSequence !== fileRequestSequenceRef.current) {
					return;
				}
				setError(
					loadError instanceof Error
						? loadError.message
						: "Failed to load config files",
				);
			} finally {
				if (requestSequence === fileRequestSequenceRef.current) {
					setLoadingFiles(false);
				}
			}
		},
		[canManageNodeConfig, clearMessages, debouncedNodeId, selectedPath],
	);

	const loadContent = useCallback(
		async (
			path: string,
			options?: {
				forceRefresh?: boolean;
			},
		) => {
			if (!debouncedNodeId) {
				return;
			}

			const requestSequence = ++contentRequestSequenceRef.current;
			setLoadingContent(true);
			clearMessages();
			try {
				const content = await getHAProxyConfigFileContent(path, debouncedNodeId, {
					forceRefresh: options?.forceRefresh,
				});
				if (requestSequence !== contentRequestSequenceRef.current) {
					return;
				}
				setOriginalContent(content);
				setDraftContent(content);
			} catch (contentError) {
				if (requestSequence !== contentRequestSequenceRef.current) {
					return;
				}
				setError(
					contentError instanceof Error
						? contentError.message
						: "Failed to load config content",
				);
			} finally {
				if (requestSequence === contentRequestSequenceRef.current) {
					setLoadingContent(false);
				}
			}
		},
		[clearMessages, debouncedNodeId],
	);

	useEffect(() => {
		if (!canManageNodeConfig) {
			setFiles([]);
			setSelectedPath(null);
			setOriginalContent("");
			setDraftContent("");
			setLoadingFiles(false);
			return;
		}

		void loadFiles();
	}, [canManageNodeConfig, loadFiles]);

	useEffect(() => {
		if (!selectedPath || !canManageNodeConfig) {
			return;
		}

		void loadContent(selectedPath);
	}, [canManageNodeConfig, loadContent, selectedPath]);

	const handleSave = useCallback(async () => {
		if (!selectedPath || !isDirty || !canManageNodeConfig || !debouncedNodeId) {
			return;
		}

		setSaving(true);
		setLastSaveFailed(false);
		clearMessages();
		try {
			await saveHAProxyConfigFile(
				selectedPath,
				draftContent,
				autoReload,
				debouncedNodeId,
			);
			setOriginalContent(draftContent);
			setNotice(formatReloadMessage(autoReload));
			setLastSaveFailed(false);
			await loadFiles(selectedPath);
		} catch (saveError) {
			setLastSaveFailed(true);
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
		debouncedNodeId,
		selectedPath,
		canManageNodeConfig,
	]);

	const handleCreateFile = useCallback(async () => {
		if (!canManageNodeConfig || !debouncedNodeId) {
			setError("Please set HAProxy config path in Node Configuration first.");
			return;
		}

		const normalizedPath = newFilePath.trim();
		if (!normalizedPath) {
			setError("Please provide a file path, e.g. service/api.cfg");
			return;
		}

		setCreating(true);
		clearMessages();
		try {
			await createHAProxyConfigFile(normalizedPath, "", false, debouncedNodeId);
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
	}, [
		canManageNodeConfig,
		clearMessages,
		loadFiles,
		newFilePath,
		debouncedNodeId,
	]);

	const handleDelete = useCallback(async () => {
		if (!selectedPath || !canManageNodeConfig || !debouncedNodeId) {
			return;
		}

		const confirmed = window.confirm(`Delete ${selectedPath}?`);
		if (!confirmed) {
			return;
		}

		setRemoving(true);
		clearMessages();
		try {
			await deleteHAProxyConfigFile(selectedPath, autoReload, debouncedNodeId);
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
	}, [
		autoReload,
		canManageNodeConfig,
		clearMessages,
		loadFiles,
		debouncedNodeId,
		selectedPath,
	]);

	const handleManualReload = useCallback(async () => {
		if (!canManageNodeConfig || !debouncedNodeId) {
			setError("Please set HAProxy config path in Node Configuration first.");
			return;
		}

		if (reloadBlockedReason) {
			setError(reloadBlockedReason);
			return;
		}

		setReloading(true);
		clearMessages();
		try {
			await reloadHAProxyConfig(debouncedNodeId);
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
	}, [canManageNodeConfig, clearMessages, debouncedNodeId, reloadBlockedReason]);

	const handleRefreshFiles = useCallback(async () => {
		if (!canManageNodeConfig) {
			setError("Please select a node with a valid config path first.");
			return;
		}

		await loadFiles(selectedPath, { forceRefresh: true });
		if (selectedPath) {
			await loadContent(selectedPath, { forceRefresh: true });
		}
		setNotice("Files refreshed from source");
	}, [canManageNodeConfig, loadContent, loadFiles, selectedPath]);

	return (
		<Card className="border-border/70">
			<CardHeader className="space-y-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div>
						<CardTitle>HAProxy Config Editor</CardTitle>
						<p className="mt-1 text-sm text-muted-foreground">
							Manage every file inside the selected node config directory with
							Monaco.
						</p>
						{hasConfiguredRootPath && (
							<p className="mt-1 text-xs text-muted-foreground">
								Node: {selectedNodeName ?? "Unknown"} | Config root:{" "}
								{configuredRootPath}
							</p>
						)}
					</div>
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							onClick={handleManualReload}
							disabled={
								reloading || !canManageNodeConfig || Boolean(reloadBlockedReason)
							}
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
				{reloadBlockedReason && canManageNodeConfig && (
					<p className="text-xs text-amber-700">{reloadBlockedReason}</p>
				)}

				<div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
					<Input
						placeholder="new-service.cfg or nested/path/service.cfg (relative path)"
						value={newFilePath}
						onChange={(event) => setNewFilePath(event.target.value)}
						disabled={!canManageNodeConfig}
					/>
					<Button
						onClick={handleCreateFile}
						disabled={creating || !canManageNodeConfig}
					>
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
					<div className="flex items-center justify-end gap-2">
						<p className="text-sm text-muted-foreground">
							{filteredFiles.length} / {files.length} files
						</p>
						<Button
							variant="outline"
							onClick={() => void handleRefreshFiles()}
							disabled={loadingFiles || loadingContent || !canManageNodeConfig}
						>
							{loadingFiles || loadingContent ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<RefreshCw className="h-4 w-4" />
							)}
							Refresh Files
						</Button>
					</div>
				</div>

				<div className="flex flex-wrap items-center justify-between gap-2">
					<label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
						<input
							type="checkbox"
							checked={autoReload}
							onChange={(event) => setAutoReload(event.target.checked)}
							className="h-4 w-4 rounded border-border"
							disabled={!canManageNodeConfig}
						/>
						Auto reload after save/delete
					</label>
					<div className="flex items-center gap-2">
						<Button
							variant="destructive"
							onClick={handleDelete}
							disabled={!selectedPath || removing || !canManageNodeConfig}
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
							disabled={
								!isDirty || saving || loadingContent || !canManageNodeConfig
							}
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

				{!canManageNodeConfig && (
					<div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
						{isNodeSwitching
							? "Switching node... loading scoped config data."
							: "Please select a managed node and set HAProxy config path in Node Configuration before using Config Editor."}
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
