import { useEffect, useState } from "react";
import { apiClient } from "./lib/api";

type StatsResponse = NonNullable<
    Awaited<ReturnType<typeof apiClient.haproxy.stats.get>>["data"]
>;

function App() {
    const [res, setRes] = useState<StatsResponse | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            const { data, error } = await apiClient.haproxy.stats.get();
            
            if (data) {
                setRes(data);
            } else if (error) {
                console.error("API Error:", error);
            }
        };
        fetchData();
    }, []);

    return (
        <div>
            {res ? (
                <div>
                    <h1>HAProxy Stats</h1>
                    <p>Status: {res.status}</p>
                    <p>Uptime: {res.uptime}</p>
                    <p>Active Sessions: {res.active_sessions}</p>
                </div>
            ) : (
                "Loading..."
            )}
        </div>
    );
}

export default App;