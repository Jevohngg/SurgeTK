document.addEventListener("DOMContentLoaded", () => {
    const householdIdElement = document.getElementById("household-id");
    if (!householdIdElement) {
        console.error("Household ID element not found on the page.");
        return;
    }
    const householdId = householdIdElement.value;

    let netWorthChart = null;
    let assetAllocationChart = null;
    let monthlyNetWorthChart = null;

    async function fetchHouseholdSummary(householdId) {
        try {
            const response = await fetch(`/api/households/${householdId}/accounts-summary`);
            if (!response.ok) {
                throw new Error(`Error fetching data: ${response.statusText}`);
            }

            const { totalNetWorth, assetAllocation } = await response.json();

            // Ensure assetAllocation is a valid object
            if (!assetAllocation || typeof assetAllocation !== "object") {
                console.warn("Asset allocation data is invalid or missing.");
            }

            updateNetWorthChart(totalNetWorth);
            updateAssetAllocationChart(assetAllocation);

            const netWorthValueElement = document.getElementById("net-worth-value");
            if (netWorthValueElement) {
                netWorthValueElement.textContent = totalNetWorth
                    ? `$${totalNetWorth.toLocaleString()}`
                    : "Data unavailable";
            }
        } catch (error) {
            console.error("Error fetching household summary:", error);
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
        }
    }

    function updateNetWorthChart(totalNetWorth) {
        const ctx = document.getElementById("netWorthChart").getContext("2d");

        // Using #11B7AB for primary, and a lighter complimentary color for the second segment
        const primaryColor = "#11B7AB";
        const secondaryColor = "#A9EAE5"; // Lighter tint complementing #11B7AB

        if (netWorthChart) {
            netWorthChart.data.datasets[0].data[0] = totalNetWorth || 0;
            netWorthChart.data.datasets[0].data[1] = Math.max(0, 1000000 - (totalNetWorth || 0));
            netWorthChart.update();
        } else {
            netWorthChart = new Chart(ctx, {
                type: "doughnut",
                data: {
                    labels: ["Net Worth", "Remaining Target"],
                    datasets: [
                        {
                            label: "Net Worth Overview",
                            data: [totalNetWorth || 0, Math.max(0, 1000000 - (totalNetWorth || 0))],
                            backgroundColor: [primaryColor, secondaryColor],
                        },
                    ],
                },
                options: {
                    plugins: {
                        tooltip: { enabled: true },
                    },
                },
            });
        }
    }

    function updateAssetAllocationChart(assetAllocation) {
        const assetAllocationChartElement = document.getElementById("assetAllocationChart");
        if (!assetAllocationChartElement) {
            console.error("Asset allocation chart element not found.");
            return;
        }

        // Handle empty or invalid assetAllocation
        if (!assetAllocation || typeof assetAllocation !== "object" || Object.keys(assetAllocation).length === 0) {
            console.warn("No asset allocation data to display.");
            if (assetAllocationChart) {
                assetAllocationChart.data.labels = [];
                assetAllocationChart.data.datasets[0].data = [];
                assetAllocationChart.update();
            }
            return;
        }

        const ctx = assetAllocationChartElement.getContext("2d");
        const labels = Object.keys(assetAllocation);
        const data = Object.values(assetAllocation);

        // Define a color palette based on #11B7AB and #1a1e24, plus related tints/shades
        const colorPalette = [
            "#11B7AB",   // main accent
            "#16dbc7",   // lighter teal
            "#0e9288",   // darker teal
            "#82c9c3",   // pastel teal
            "#5c7370",   // a neutral grayish tone to complement
            "#1a1e24"    // the dark color provided
        ];

        // If there are more labels than colors, loop through the palette
        const backgroundColors = labels.map((_, i) => colorPalette[i % colorPalette.length]);

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

        // Use #11B7AB for line and a transparent version of it for background
        const lineColor = "#11B7AB";
        const fillColor = "rgba(17, 183, 171, 0.2)";

        const ctx = chartElement.getContext("2d");
        if (!monthlyNetWorth || monthlyNetWorth.length === 0) {
            console.warn("No monthly net worth data available.");
            if (monthlyNetWorthChart) {
                monthlyNetWorthChart.data.labels = [];
                monthlyNetWorthChart.data.datasets[0].data = [];
                monthlyNetWorthChart.update();
            }
            return;
        }

        const labels = monthlyNetWorth.map((item) => item.month);
        const data = monthlyNetWorth.map((item) => item.netWorth);

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
