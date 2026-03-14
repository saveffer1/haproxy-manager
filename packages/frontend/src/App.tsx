import { useEffect, useState } from "react";
import { apiClient } from "./lib/api";
import "./App.css";

type StatsResponse = NonNullable<
	Awaited<ReturnType<typeof apiClient.haproxy.stats.get>>["data"]
>;

type Node = {
	id: string;
	name: string;
	ipAddress: string;
	type: "managed" | "monitored";
	logStrategy: "docker" | "file" | "journald";
	logPath?: string;
	sshUser: string;
	createdAt: string;
};

function App() {
	const [stats, setStats] = useState<StatsResponse | null>(null);
	const [nodes, setNodes] = useState<Node[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [showAddForm, setShowAddForm] = useState(false);
	const [formData, setFormData] = useState({
		name: "",
		ipAddress: "",
		type: "monitored" as const,
		logStrategy: "docker" as const,
		sshUser: "root",
		logPath: "",
	});

	// Fetch stats and nodes
	useEffect(() => {
		const fetchData = async () => {
			setLoading(true);
			try {
				const [statsRes, nodesRes] = await Promise.all([
					apiClient.haproxy.stats.get(),
					apiClient.api.nodes.get(),
				]);

				if (statsRes.data) {
					setStats(statsRes.data);
				}
				if (nodesRes.data && "data" in nodesRes.data) {
					setNodes(nodesRes.data.data || []);
				}
			} catch (err) {
				setError("Failed to fetch data");
				console.error(err);
			} finally {
				setLoading(false);
			}
		};

		fetchData();
		const interval = setInterval(fetchData, 10000); // Refresh every 10 seconds
		return () => clearInterval(interval);
	}, []);

	// Handle adding node
	const handleAddNode = async (e: React.FormEvent) => {
		e.preventDefault();
		try {
			const res = await apiClient.api.nodes.post(formData);
			if ("data" in res && res.data && "success" in res.data && res.data.success) {
				setNodes([...nodes, res.data.data as Node]);
				setFormData({
					name: "",
					ipAddress: "",
					type: "monitored",
					logStrategy: "docker",
					sshUser: "root",
					logPath: "",
				});
				setShowAddForm(false);
			}
		} catch (err) {
			setError("Failed to add node");
			console.error(err);
		}
	};

	// Handle deleting node
	const handleDeleteNode = async (id: string) => {
		if (!confirm("Are you sure you want to delete this node?")) return;
		try {
			await apiClient.api.nodes[id].delete();
			setNodes(nodes.filter((n) => n.id !== id));
		} catch (err) {
			setError("Failed to delete node");
			console.error(err);
		}
	};

	if (loading) {
		return <div className="container">Loading...</div>;
	}

	return (
		<div className="container">
			<header className="header">
				<h1>🚀 HAProxy Manager</h1>
				<p>Manage your HAProxy infrastructure</p>
			</header>

			{error && <div className="error-banner">{error}</div>}

			<div className="dashboard">
				{/* Stats Card */}
				<section className="stats-card">
					<h2>HAProxy Status</h2>
					{stats ? (
						<div className="stats-grid">
							<div className="stat-item">
								<span className="stat-label">Status</span>
								<span className="stat-value online">{stats.status}</span>
							</div>
							<div className="stat-item">
								<span className="stat-label">Uptime</span>
								<span className="stat-value">{stats.uptime}</span>
							</div>
							<div className="stat-item">
								<span className="stat-label">Active Sessions</span>
								<span className="stat-value">{stats.active_sessions}</span>
							</div>
							<div className="stat-item">
								<span className="stat-label">Connections/s</span>
								<span className="stat-value">{stats.connections_rate}</span>
							</div>
						</div>
					) : (
						<p>No stats available</p>
					)}
				</section>

				{/* Nodes Management */}
				<section className="nodes-section">
					<div className="section-header">
						<h2>Managed Nodes ({nodes.length})</h2>
						<button
							className="btn btn-primary"
							onClick={() => setShowAddForm(!showAddForm)}
						>
							{showAddForm ? "Cancel" : "+ Add Node"}
						</button>
					</div>

					{/* Add Node Form */}
					{showAddForm && (
						<form onSubmit={handleAddNode} className="node-form">
							<div className="form-group">
								<label>Node Name *</label>
								<input
									type="text"
									value={formData.name}
									onChange={(e) =>
										setFormData({ ...formData, name: e.target.value })
									}
									required
									placeholder="e.g., web-server-1"
								/>
							</div>

							<div className="form-group">
								<label>IP Address *</label>
								<input
									type="text"
									value={formData.ipAddress}
									onChange={(e) =>
										setFormData({ ...formData, ipAddress: e.target.value })
									}
									required
									placeholder="e.g., 192.168.1.100"
								/>
							</div>

							<div className="form-row">
								<div className="form-group">
									<label>Type</label>
									<select
										value={formData.type}
										onChange={(e) =>
											setFormData({
												...formData,
												type: e.target.value as "managed" | "monitored",
											})
										}
									>
										<option value="monitored">Monitored</option>
										<option value="managed">Managed</option>
									</select>
								</div>

								<div className="form-group">
									<label>Log Strategy</label>
									<select
										value={formData.logStrategy}
										onChange={(e) =>
											setFormData({
												...formData,
												logStrategy: e.target.value as
													| "docker"
													| "file"
													| "journald",
											})
										}
									>
										<option value="docker">Docker</option>
										<option value="file">File</option>
										<option value="journald">Journald</option>
									</select>
								</div>
							</div>

							<div className="form-group">
								<label>SSH User</label>
								<input
									type="text"
									value={formData.sshUser}
									onChange={(e) =>
										setFormData({ ...formData, sshUser: e.target.value })
									}
									placeholder="root"
								/>
							</div>

							<div className="form-group">
								<label>Log Path</label>
								<input
									type="text"
									value={formData.logPath}
									onChange={(e) =>
										setFormData({ ...formData, logPath: e.target.value })
									}
									placeholder="/var/log/haproxy.log"
								/>
							</div>

							<button type="submit" className="btn btn-success">
								Add Node
							</button>
						</form>
					)}

					{/* Nodes List */}
					<div className="nodes-list">
						{nodes.length === 0 ? (
							<p className="empty-state">No nodes configured yet. Add one to get started!</p>
						) : (
							nodes.map((node) => (
								<div key={node.id} className="node-card">
									<div className="node-header">
										<h3>{node.name}</h3>
										<span className={`badge badge-${node.type}`}>
											{node.type}
										</span>
									</div>
									<div className="node-details">
										<p>
											<strong>IP:</strong> {node.ipAddress}
										</p>
										<p>
											<strong>Type:</strong> {node.type}
										</p>
										<p>
											<strong>Log Strategy:</strong> {node.logStrategy}
										</p>
										<p>
											<strong>SSH User:</strong> {node.sshUser}
										</p>
										{node.logPath && (
											<p>
												<strong>Log Path:</strong> {node.logPath}
											</p>
										)}
										<p className="created-at">
											Created: {new Date(node.createdAt).toLocaleString()}
										</p>
									</div>
									<button
										className="btn btn-danger btn-small"
										onClick={() => handleDeleteNode(node.id)}
									>
										Delete
									</button>
								</div>
							))
						)}
					</div>
				</section>

				{/* External Links */}
				<section className="links-section">
					<h3>Quick Links</h3>
					<div className="links-grid">
						<a
							href="http://localhost:8404/stats"
							target="_blank"
							rel="noopener noreferrer"
							className="link-card"
						>
							📊 HAProxy Stats Dashboard
						</a>
						<a
							href="http://localhost:3000/swagger"
							target="_blank"
							rel="noopener noreferrer"
							className="link-card"
						>
							📚 API Documentation
						</a>
						<a
							href="http://localhost:16686"
							target="_blank"
							rel="noopener noreferrer"
							className="link-card"
						>
							🔍 Jaeger Tracing
						</a>
					</div>
				</section>
			</div>
		</div>
	);
}

export default App;
