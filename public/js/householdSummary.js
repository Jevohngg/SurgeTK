document.addEventListener("DOMContentLoaded", () => {
    const householdIdElement = document.getElementById("household-id");
    if (!householdIdElement) {
        console.error("Household ID element not found on the page.");
        return;
    }
    const householdId = householdIdElement.value;

    let assetAllocationChart = null;
    let monthlyNetWorthChart = null;

    async function fetchHouseholdSummary(householdId) {
        try {
            const response = await fetch(`/api/households/${householdId}/accounts-summary`);
            if (!response.ok) {
                throw new Error(`Error fetching data: ${response.statusText}`);
            }

            const { assetAllocation } = await response.json();
            updateAssetAllocationChart(assetAllocation);
        } catch (error) {
            console.error("Error fetching household summary:", error);
            // Show empty state for asset allocation chart on error
            updateAssetAllocationChart(null);
        }
    }

    async function fetchMonthlyNetWorth(householdId) {
        try {
            const response = await fetch(`/api/households/${householdId}/monthly-net-worth`);
            if (!response.ok) {
                throw new Error(`Error fetching monthly net worth data: ${response.statusText}`);
            }

            const { monthlyNetWorth } = await response.json();
            updateMonthlyNetWorthChart(monthlyNetWorth);
        } catch (error) {
            console.error("Error fetching monthly net worth:", error);
            // Show empty state for monthly chart on error
            updateMonthlyNetWorthChart(null);
        }
    }

    function updateAssetAllocationChart(assetAllocation) {
        const assetAllocationChartElement = document.getElementById("assetAllocationChart");
        if (!assetAllocationChartElement) {
            console.error("Asset allocation chart element not found.");
            return;
        }

        const ctx = assetAllocationChartElement.getContext("2d");

        let labels, data, backgroundColors;

        if (assetAllocation && typeof assetAllocation === "object" && Object.keys(assetAllocation).length > 0) {
            labels = Object.keys(assetAllocation);
            data = Object.values(assetAllocation);

            // Define a color palette
            const colorPalette = [
                "#11B7AB",   // main accent
                "#16dbc7",   
                "#0e9288",   
                "#82c9c3",   
                "#5c7370",   
                "#1a1e24"    
            ];

            backgroundColors = labels.map((_, i) => colorPalette[i % colorPalette.length]);
        } else {
            // No data scenario
            labels = ["No Data"];
            data = [0];
            backgroundColors = ["#11B7AB"]; // Single color for no data
        }

        if (assetAllocationChart) {
            assetAllocationChart.data.labels = labels;
            assetAllocationChart.data.datasets[0].data = data;
            assetAllocationChart.data.datasets[0].backgroundColor = backgroundColors;
            assetAllocationChart.update();
        } else {
            assetAllocationChart = new Chart(ctx, {
                type: "pie",
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: "Asset Allocation",
                            data: data,
                            backgroundColor: backgroundColors,
                        },
                    ],
                },
                options: {
                    plugins: {
                        tooltip: { enabled: true },
                    },
                    animation: {
                        duration: 1000, // for example, 1000ms
                        easing: 'easeOutBounce'
                    },
                },
            });
        }
    }

    function updateMonthlyNetWorthChart(monthlyNetWorth) {
        const chartElement = document.getElementById("monthlyNetWorthChart");
        if (!chartElement || !(chartElement instanceof HTMLCanvasElement)) {
            console.error("Monthly net worth chart canvas not found or not a canvas element.");
            return;
        }

        const lineColor = "#11B7AB";
        const fillColor = "rgba(17, 183, 171, 0.2)";
        const ctx = chartElement.getContext("2d");

        let labels, data;
        if (monthlyNetWorth && monthlyNetWorth.length > 0) {
            labels = monthlyNetWorth.map((item) => item.month);
            data = monthlyNetWorth.map((item) => item.netWorth);
        } else {
            // No data scenario
            labels = ["No Data"];
            data = [0];
        }

        if (monthlyNetWorthChart) {
            monthlyNetWorthChart.data.labels = labels;
            monthlyNetWorthChart.data.datasets[0].data = data;
            monthlyNetWorthChart.update();
        } else {
            monthlyNetWorthChart = new Chart(ctx, {
                type: "line",
                data: {
                    labels: labels,
                    datasets: [
                        {
                            label: "Net Worth Growth",
                            data: data,
                            borderColor: lineColor,
                            fill: true,
                            backgroundColor: fillColor,
                            tension: 0.3,
                        },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: {
                            title: { display: true, text: "Month" },
                        },
                        y: {
                            title: { display: true, text: "Net Worth (USD)" },
                            ticks: {
                                callback: (value) => `$${Number(value).toLocaleString()}`,
                            },
                        },
                    },
                    plugins: {
                        tooltip: { enabled: true },
                    },
                },
            });
        }
    }

    // Initial data fetch
    fetchHouseholdSummary(householdId);
    fetchMonthlyNetWorth(householdId);

    // Real-time updates via Socket.IO
    if (typeof io !== "undefined") {
        const socket = io();
        socket.on("accountChanged", (data) => {
            const { action } = data;
            if (action === "add" || action === "update" || action === "delete") {
                fetchHouseholdSummary(householdId);
                fetchMonthlyNetWorth(householdId);
            }
        });
    } else {
        console.warn("Socket.IO not available. Real-time updates will not work.");
    }
});
