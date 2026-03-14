import {
	CheckCircle2,
	ClipboardCopy,
	Loader2,
	Plus,
	Save,
	ServerCog,
	Trash2,
	X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	createNode,
	deleteNode,
	getSshPublicKey,
	type NodeConfigUpdateInput,
	type NodeOutput,
	testSshConnection,
	updateNodeConfiguration,
} from "@/lib/api";

type NodeConfigurationProps = {
	nodes: NodeOutput[];
	selectedNode: NodeOutput | null;
	onSaved: (updatedNode: NodeOutput) => void;
	onNodeCreated: (createdNode: NodeOutput) => void;
	onNodeDeleted: (deletedNodeId: string, nextNodeId: string | null) => void;
};

type NodeConfigDraft = {
	name: string;
	ipAddress: string;
	isLocalService: boolean;
	nodeType: "managed" | "monitored";
	source: "manual" | "docker" | "remote" | "api";
	statsUrl: string;
	apiUrl: string;
	haproxyContainerRef: string;
	sshUser: string;
	sshPort: string;
	configPath: string;
	logPath: string;
	logSource: "container" | "forwarded";
};

type AddNodeDraft = {
	name: string;
	ipAddress: string;
	isLocalService: boolean;
	type: "managed" | "monitored";
	source: "manual" | "docker" | "remote" | "api";
};

const initialAddNodeDraft: AddNodeDraft = {
	name: "",
	ipAddress: "127.0.0.1",
	isLocalService: true,
	type: "managed",
	source: "manual",
};

function isLocalHostValue(value: string) {
	const host = value.trim().toLowerCase();
	return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function defaultDraft(selectedNode: NodeOutput | null): NodeConfigDraft {
	const isLocalFallback = selectedNode
		? isLocalHostValue(selectedNode.ipAddress) &&
			selectedNode.source === "manual"
		: false;

	return {
		name: selectedNode?.name ?? "",
		ipAddress: selectedNode?.ipAddress ?? "",
		isLocalService: selectedNode?.isLocalService ?? isLocalFallback,
		nodeType: selectedNode?.type ?? "managed",
		source: selectedNode?.source ?? "manual",
		statsUrl:
			selectedNode?.haproxyStatsUrl ??
			(selectedNode ? `http://${selectedNode.ipAddress}:8404/stats` : ""),
		apiUrl:
			selectedNode?.haproxyApiUrl ??
			(selectedNode ? `http://${selectedNode.ipAddress}:3000` : ""),
		haproxyContainerRef: selectedNode?.haproxyContainerRef ?? "",
		sshUser: selectedNode?.sshUser ?? "root",
		sshPort:
			typeof selectedNode?.sshPort === "number"
				? String(selectedNode.sshPort)
				: "22",
		configPath: selectedNode?.haproxyConfigPath ?? "",
		logPath: selectedNode?.haproxyLogPath ?? "",
		logSource: selectedNode?.haproxyLogSource ?? "container",
	};
}

function getSshTroubleshootingHint(
	draft: NodeConfigDraft,
	message: string | null,
) {
	if (!message) {
		return null;
	}

	const host = draft.ipAddress.trim().toLowerCase();
	const lowerMessage = message.toLowerCase();
	const isLocal =
		host === "127.0.0.1" || host === "localhost" || host === "::1";

	if (isLocal && lowerMessage.includes("connection refused")) {
		return "Windows localhost usually has no SSH server running. If HAProxy runs in Docker, SSH to a Linux host/container with sshd instead of 127.0.0.1, or install/enable OpenSSH Server on the target host.";
	}

	if (lowerMessage.includes("permission denied")) {
		return "Use Copy Public Key, then add the key to ~/.ssh/authorized_keys on the target host for this SSH user.";
	}

	return null;
}

export default function NodeConfiguration({
	nodes,
	selectedNode,
	onSaved,
	onNodeCreated,
	onNodeDeleted,
}: NodeConfigurationProps) {
	const [draft, setDraft] = useState<NodeConfigDraft>(
		defaultDraft(selectedNode),
	);
	const [savedMessage, setSavedMessage] = useState<string | null>(null);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [actionMessage, setActionMessage] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [showAddNodePopup, setShowAddNodePopup] = useState(false);
	const [addNodeDraft, setAddNodeDraft] =
		useState<AddNodeDraft>(initialAddNodeDraft);
	const [addingNode, setAddingNode] = useState(false);
	const [deletingNode, setDeletingNode] = useState(false);
	const [saving, setSaving] = useState(false);
	const [sshBusy, setSshBusy] = useState(false);
	const [sshStatusMessage, setSshStatusMessage] = useState<string | null>(null);
	const [sshStatusOk, setSshStatusOk] = useState(false);

	useEffect(() => {
		setDraft(defaultDraft(selectedNode));
		setSavedMessage(null);
		setErrorMessage(null);
		setActionMessage(null);
		setActionError(null);
		setSshStatusMessage(null);
		setSshStatusOk(false);
	}, [selectedNode]);

	const statsEndpointPreview = useMemo(() => {
		const statsUrl = draft.statsUrl.trim();
		if (!statsUrl) {
			return "-";
		}

		return statsUrl;
	}, [draft.statsUrl]);

	const sshTroubleshootingHint = useMemo(
		() => getSshTroubleshootingHint(draft, sshStatusMessage),
		[draft, sshStatusMessage],
	);

	const localServiceMode = useMemo(
		() => draft.isLocalService,
		[draft.isLocalService],
	);

	const toggleLocalServiceMode = (enabled: boolean) => {
		setSavedMessage(null);
		setActionMessage(null);
		setActionError(null);
		setSshStatusMessage(null);
		setSshStatusOk(false);
		setDraft((current) => {
			if (enabled) {
				return {
					...current,
					isLocalService: true,
					source: "manual",
					ipAddress: "127.0.0.1",
				};
			}

			return {
				...current,
				isLocalService: false,
			};
		});
	};

	const saveConfig = async () => {
		if (!selectedNode) {
			return;
		}

		setSaving(true);
		setSavedMessage(null);
		setErrorMessage(null);
		setActionMessage(null);
		setActionError(null);

		try {
			const parsedPort = Number.parseInt(draft.sshPort.trim(), 10);
			const payload: NodeConfigUpdateInput = {
				name: draft.name.trim(),
				ipAddress: draft.ipAddress.trim(),
				isLocalService: draft.isLocalService,
				type: draft.nodeType,
				source: draft.source,
				haproxyStatsUrl: draft.statsUrl,
				haproxyApiUrl: draft.apiUrl,
				haproxyContainerRef: draft.haproxyContainerRef,
				haproxyConfigPath: draft.configPath,
				haproxyLogPath: draft.logPath,
				haproxyLogSource: draft.logSource,
				sshUser: draft.sshUser.trim() || "root",
				sshPort: Number.isFinite(parsedPort) ? Math.max(1, parsedPort) : 22,
			};

			const updated = await updateNodeConfiguration(selectedNode.id, payload);
			onSaved(updated);
			setSavedMessage("Node configuration saved");
		} catch (error) {
			setErrorMessage(
				error instanceof Error
					? error.message
					: "Failed to save node configuration",
			);
		} finally {
			setSaving(false);
		}
	};

	const openAddNodePopup = () => {
		setAddNodeDraft(initialAddNodeDraft);
		setActionMessage(null);
		setActionError(null);
		setShowAddNodePopup(true);
	};

	const submitAddNode = async () => {
		const trimmedName = addNodeDraft.name.trim();
		const trimmedIp = addNodeDraft.ipAddress.trim();

		if (!trimmedName || !trimmedIp) {
			setActionError("Node name and IP address are required.");
			return;
		}

		setAddingNode(true);
		setActionMessage(null);
		setActionError(null);

		try {
			const createdNode = await createNode({
				name: trimmedName,
				ipAddress: trimmedIp,
				isLocalService: addNodeDraft.isLocalService,
				type: addNodeDraft.type,
				source: addNodeDraft.source,
				haproxyStatsUrl: `http://${trimmedIp}:8404/stats`,
				haproxyApiUrl: `http://${trimmedIp}:3000`,
				sshUser: "root",
				sshPort: 22,
			});

			onNodeCreated(createdNode);
			setShowAddNodePopup(false);
			setActionMessage(`Added node ${createdNode.name}.`);
		} catch (error) {
			setActionError(
				error instanceof Error ? error.message : "Failed to add node",
			);
		} finally {
			setAddingNode(false);
		}
	};

	const removeCurrentNode = async () => {
		if (!selectedNode) {
			return;
		}

		const confirmed = window.confirm(
			`Delete node ${selectedNode.name} (${selectedNode.ipAddress})?`,
		);
		if (!confirmed) {
			return;
		}

		setDeletingNode(true);
		setActionMessage(null);
		setActionError(null);

		try {
			const nextNodeId =
				nodes.find((node) => node.id !== selectedNode.id)?.id ?? null;
			await deleteNode(selectedNode.id);
			onNodeDeleted(selectedNode.id, nextNodeId);
			setActionMessage(`Deleted node ${selectedNode.name}.`);
		} catch (error) {
			setActionError(
				error instanceof Error ? error.message : "Failed to delete node",
			);
		} finally {
			setDeletingNode(false);
		}
	};

	const runSshTest = async () => {
		if (localServiceMode) {
			setSshStatusOk(true);
			setSshStatusMessage("Local service mode enabled: SSH test skipped.");
			return;
		}

		setSshBusy(true);
		setSshStatusMessage(null);
		setSshStatusOk(false);

		try {
			const parsedPort = Number.parseInt(draft.sshPort.trim(), 10);
			const result = await testSshConnection({
				ipAddress: draft.ipAddress.trim(),
				sshUser: draft.sshUser.trim() || "root",
				sshPort: Number.isFinite(parsedPort) ? parsedPort : undefined,
			});

			setSshStatusOk(result.ok);
			setSshStatusMessage(result.message);
		} catch (error) {
			setSshStatusOk(false);
			setSshStatusMessage(
				error instanceof Error ? error.message : "SSH connection test failed",
			);
		} finally {
			setSshBusy(false);
		}
	};

	const copyPublicKey = async () => {
		if (localServiceMode) {
			setSshStatusOk(true);
			setSshStatusMessage(
				"Local service mode enabled: SSH key is not required for this node.",
			);
			return;
		}

		setSshBusy(true);
		setSshStatusMessage(null);
		setSshStatusOk(false);

		try {
			const pubKey = await getSshPublicKey();
			if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(pubKey);
				setSshStatusOk(true);
				setSshStatusMessage("Public key copied to clipboard");
				return;
			}

			setSshStatusOk(true);
			setSshStatusMessage(pubKey);
		} catch (error) {
			setSshStatusOk(false);
			setSshStatusMessage(
				error instanceof Error ? error.message : "Failed to copy public key",
			);
		} finally {
			setSshBusy(false);
		}
	};

	if (!selectedNode) {
		return (
			<>
				<Card>
					<CardHeader className="flex flex-row items-center justify-between gap-2">
						<CardTitle>Node Configuration</CardTitle>
						<Button variant="outline" onClick={openAddNodePopup}>
							<Plus className="mr-2 h-4 w-4" />
							Add Node
						</Button>
					</CardHeader>
					<CardContent>
						<p className="text-sm text-muted-foreground">
							Please select a node before editing configuration.
						</p>
						{actionError && (
							<p className="mt-2 text-sm text-red-600 dark:text-red-400">
								{actionError}
							</p>
						)}
						{actionMessage && (
							<p className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">
								{actionMessage}
							</p>
						)}
					</CardContent>
				</Card>

				{showAddNodePopup && (
					<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
						<div className="w-full max-w-lg rounded-lg border border-border bg-card p-4 shadow-xl">
							<div className="mb-4 flex items-center justify-between">
								<h3 className="text-lg font-semibold text-foreground">
									Add Node
								</h3>
								<Button
									variant="ghost"
									size="icon"
									onClick={() => setShowAddNodePopup(false)}
								>
									<X className="h-4 w-4" />
								</Button>
							</div>
							<div className="grid gap-3">
								<Input
									placeholder="Node name"
									value={addNodeDraft.name}
									onChange={(event) =>
										setAddNodeDraft((current) => ({
											...current,
											name: event.target.value,
										}))
									}
								/>
								<Input
									placeholder="IP address"
									value={addNodeDraft.ipAddress}
									onChange={(event) =>
										setAddNodeDraft((current) => ({
											...current,
											ipAddress: event.target.value,
										}))
									}
								/>
								<label className="flex items-center gap-2 text-sm text-foreground">
									<input
										type="checkbox"
										checked={addNodeDraft.isLocalService}
										onChange={(event) =>
											setAddNodeDraft((current) => ({
												...current,
												isLocalService: event.target.checked,
												source: event.target.checked
													? "manual"
													: current.source,
												ipAddress: event.target.checked
													? "127.0.0.1"
													: current.ipAddress,
											}))
										}
									/>
									Use Local Service Mode
								</label>
							</div>
							<div className="mt-4 flex items-center justify-end gap-2">
								<Button
									variant="ghost"
									onClick={() => setShowAddNodePopup(false)}
									disabled={addingNode}
								>
									Cancel
								</Button>
								<Button
									onClick={() => void submitAddNode()}
									disabled={addingNode}
								>
									{addingNode ? (
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									) : (
										<Plus className="mr-2 h-4 w-4" />
									)}
									Create Node
								</Button>
							</div>
						</div>
					</div>
				)}
			</>
		);
	}

	return (
		<section className="space-y-4">
			<div className="flex items-start justify-between gap-2">
				<div>
					<h2 className="text-xl font-semibold text-foreground">
						Node Configuration
					</h2>
					<p className="text-sm text-muted-foreground">
						Configure where node stats and control API are reached via URLs.
					</p>
				</div>
				<Button variant="outline" onClick={openAddNodePopup}>
					<Plus className="mr-2 h-4 w-4" />
					Add Node
				</Button>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>{selectedNode.name}</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					{actionError && (
						<div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
							{actionError}
						</div>
					)}
					{actionMessage && (
						<div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
							{actionMessage}
						</div>
					)}

					{errorMessage && (
						<div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
							{errorMessage}
						</div>
					)}

					<label className="flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground">
						<input
							type="checkbox"
							checked={localServiceMode}
							onChange={(event) => toggleLocalServiceMode(event.target.checked)}
							className="h-4 w-4 rounded border-border"
						/>
						<span>Use Local Service Mode (skip SSH)</span>
					</label>

					<div className="grid gap-4 md:grid-cols-2">
						<div>
							<p className="mb-1 text-xs uppercase tracking-[0.12em] text-muted-foreground">
								Node Name
							</p>
							<Input
								value={draft.name}
								onChange={(event) => {
									setSavedMessage(null);
									setDraft((current) => ({
										...current,
										name: event.target.value,
									}));
								}}
								placeholder="local-haproxy-node"
							/>
						</div>

						<div>
							<p className="mb-1 text-xs uppercase tracking-[0.12em] text-muted-foreground">
								Node Type
							</p>
							<select
								value={draft.nodeType}
								onChange={(event) => {
									setSavedMessage(null);
									setDraft((current) => ({
										...current,
										nodeType: event.target.value as NodeConfigDraft["nodeType"],
									}));
								}}
								className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
							>
								<option value="managed">Managed</option>
								<option value="monitored">Monitored</option>
							</select>
						</div>

						<div>
							<p className="mb-1 text-xs uppercase tracking-[0.12em] text-muted-foreground">
								Source
							</p>
							<select
								value={draft.source}
								onChange={(event) => {
									setSavedMessage(null);
									setDraft((current) => ({
										...current,
										source: event.target.value as NodeConfigDraft["source"],
									}));
								}}
								className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
							>
								<option value="manual">Manual</option>
								<option value="docker">Docker Service</option>
								<option value="remote">Remote Host</option>
								<option value="api">External API</option>
							</select>
						</div>

						<div>
							<p className="mb-1 text-xs uppercase tracking-[0.12em] text-muted-foreground">
								Node IP
							</p>
							<Input
								value={draft.ipAddress}
								onChange={(event) => {
									setSavedMessage(null);
									setDraft((current) => ({
										...current,
										ipAddress: event.target.value,
									}));
								}}
								placeholder="127.0.0.1"
							/>
						</div>

						<div>
							<p className="mb-1 text-xs uppercase tracking-[0.12em] text-muted-foreground">
								HAProxy Stats URL
							</p>
							<Input
								value={draft.statsUrl}
								onChange={(event) => {
									setSavedMessage(null);
									setDraft((current) => ({
										...current,
										statsUrl: event.target.value,
									}));
								}}
								placeholder="http://127.0.0.1:8404/stats"
							/>
						</div>

						<div>
							<p className="mb-1 text-xs uppercase tracking-[0.12em] text-muted-foreground">
								HAProxy API URL
							</p>
							<Input
								value={draft.apiUrl}
								onChange={(event) => {
									setSavedMessage(null);
									setDraft((current) => ({
										...current,
										apiUrl: event.target.value,
									}));
								}}
								placeholder="http://127.0.0.1:3000"
							/>
						</div>

						<div>
							<p className="mb-1 text-xs uppercase tracking-[0.12em] text-muted-foreground">
								HAProxy Container (Name or ID)
							</p>
							<Input
								value={draft.haproxyContainerRef}
								onChange={(event) => {
									setSavedMessage(null);
									setDraft((current) => ({
										...current,
										haproxyContainerRef: event.target.value,
									}));
								}}
								placeholder="haproxy or 1c7402015a88"
							/>
							<p className="mt-1 text-xs text-muted-foreground">
								Optional but recommended for remote nodes with multiple HAProxy
								containers.
							</p>
						</div>

						{!localServiceMode && (
							<>
								<div>
									<p className="mb-1 text-xs uppercase tracking-[0.12em] text-muted-foreground">
										SSH User
									</p>
									<Input
										value={draft.sshUser}
										onChange={(event) => {
											setSavedMessage(null);
											setDraft((current) => ({
												...current,
												sshUser: event.target.value,
											}));
										}}
										placeholder="root"
									/>
								</div>

								<div>
									<p className="mb-1 text-xs uppercase tracking-[0.12em] text-muted-foreground">
										SSH Port
									</p>
									<Input
										value={draft.sshPort}
										onChange={(event) => {
											setSavedMessage(null);
											setDraft((current) => ({
												...current,
												sshPort: event.target.value,
											}));
										}}
										placeholder="22"
									/>
								</div>
							</>
						)}

						<div>
							<p className="mb-1 text-xs uppercase tracking-[0.12em] text-muted-foreground">
								HAProxy Config Path
							</p>
							<Input
								value={draft.configPath}
								onChange={(event) => {
									setSavedMessage(null);
									setDraft((current) => ({
										...current,
										configPath: event.target.value,
									}));
								}}
								placeholder="./haproxy/conf.d"
							/>
						</div>

						<div>
							<p className="mb-1 text-xs uppercase tracking-[0.12em] text-muted-foreground">
								HAProxy Log Path
							</p>
							<Input
								value={draft.logPath}
								onChange={(event) => {
									setSavedMessage(null);
									setDraft((current) => ({
										...current,
										logPath: event.target.value,
									}));
								}}
								placeholder="/var/log/haproxy.log (optional)"
							/>
						</div>

						<div>
							<p className="mb-1 text-xs uppercase tracking-[0.12em] text-muted-foreground">
								Log Source
							</p>
							<select
								value={draft.logSource}
								onChange={(event) => {
									setSavedMessage(null);
									setDraft((current) => ({
										...current,
										logSource: event.target
											.value as NodeConfigDraft["logSource"],
									}));
								}}
								className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
							>
								<option value="container">Container</option>
								<option value="forwarded">Forwarded / External</option>
							</select>
						</div>
					</div>

					<div className="rounded-md border border-border bg-background p-3 text-sm">
						<p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
							Stats Endpoint Preview
						</p>
						<p className="mt-1 font-medium text-foreground">
							{statsEndpointPreview}
						</p>
					</div>

					<div className="flex items-center gap-3">
						<Button onClick={() => void saveConfig()} disabled={saving}>
							{saving ? (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							) : (
								<Save className="mr-2 h-4 w-4" />
							)}
							{saving ? "Saving..." : "Save Node Config"}
						</Button>
						<Button
							variant="destructive"
							onClick={() => void removeCurrentNode()}
							disabled={deletingNode}
						>
							{deletingNode ? (
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							) : (
								<Trash2 className="mr-2 h-4 w-4" />
							)}
							Delete Node
						</Button>
						{savedMessage && (
							<div className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300">
								<CheckCircle2 className="h-4 w-4" />
								{savedMessage}
							</div>
						)}
					</div>

					<div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-background p-3">
						{localServiceMode ? (
							<p className="text-sm text-muted-foreground">
								Local mode active. SSH test and key setup are disabled for this
								node.
							</p>
						) : (
							<>
								<Button
									variant="outline"
									onClick={() => void runSshTest()}
									disabled={sshBusy || !draft.ipAddress.trim()}
								>
									<ServerCog className="mr-2 h-4 w-4" />
									Test SSH Access
								</Button>
								<Button
									variant="outline"
									onClick={() => void copyPublicKey()}
									disabled={sshBusy}
								>
									<ClipboardCopy className="mr-2 h-4 w-4" />
									Copy Public Key
								</Button>
							</>
						)}
						{sshBusy && (
							<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
						)}
						{sshStatusMessage && (
							<p
								className={`text-sm ${sshStatusOk ? "text-emerald-600 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}
							>
								{sshStatusOk ? (
									<CheckCircle2 className="mr-1 inline h-4 w-4" />
								) : null}
								{sshStatusMessage}
							</p>
						)}
						{!sshStatusOk && sshTroubleshootingHint && (
							<p className="text-xs text-muted-foreground">
								{sshTroubleshootingHint}
							</p>
						)}
					</div>
				</CardContent>
			</Card>

			{showAddNodePopup && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
					<div className="w-full max-w-lg rounded-lg border border-border bg-card p-4 shadow-xl">
						<div className="mb-4 flex items-center justify-between">
							<h3 className="text-lg font-semibold text-foreground">
								Add Node
							</h3>
							<Button
								variant="ghost"
								size="icon"
								onClick={() => setShowAddNodePopup(false)}
							>
								<X className="h-4 w-4" />
							</Button>
						</div>
						<div className="grid gap-3">
							<Input
								placeholder="Node name"
								value={addNodeDraft.name}
								onChange={(event) =>
									setAddNodeDraft((current) => ({
										...current,
										name: event.target.value,
									}))
								}
							/>
							<Input
								placeholder="IP address"
								value={addNodeDraft.ipAddress}
								onChange={(event) =>
									setAddNodeDraft((current) => ({
										...current,
										ipAddress: event.target.value,
										isLocalService: isLocalHostValue(event.target.value),
									}))
								}
							/>
							<label className="flex items-center gap-2 text-sm text-foreground">
								<input
									type="checkbox"
									checked={addNodeDraft.isLocalService}
									onChange={(event) =>
										setAddNodeDraft((current) => ({
											...current,
											isLocalService: event.target.checked,
											source: event.target.checked ? "manual" : current.source,
											ipAddress: event.target.checked
												? "127.0.0.1"
												: current.ipAddress,
										}))
									}
								/>
								Use Local Service Mode
							</label>
						</div>
						<div className="mt-4 flex items-center justify-end gap-2">
							<Button
								variant="ghost"
								onClick={() => setShowAddNodePopup(false)}
								disabled={addingNode}
							>
								Cancel
							</Button>
							<Button
								onClick={() => void submitAddNode()}
								disabled={addingNode}
							>
								{addingNode ? (
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								) : (
									<Plus className="mr-2 h-4 w-4" />
								)}
								Create Node
							</Button>
						</div>
					</div>
				</div>
			)}
		</section>
	);
}
