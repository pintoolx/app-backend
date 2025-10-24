import { HermesClient } from '@pythnetwork/hermes-client'


const connection = new HermesClient("https://hermes.pyth.network", {}); // See Hermes endpoints section below for other endpoints

export async function priceFeed(priceIds: string[]) {
    console.log("Starting to listen for price updates...");

    // Streaming price updates
    const eventSource = await connection.getPriceUpdatesStream(priceIds);
    var currentPrice: number;
    eventSource.onmessage = (event) => {
        const priceUpdate = JSON.parse(event.data);
        currentPrice = parseInt(priceUpdate.parsed.price.price);
        console.log("Received price update:", priceUpdate.parsed);
    };

    eventSource.onerror = (error) => {
        console.error("Error receiving updates:", error);
        eventSource.close();
    };

    // To stop listening to the updates, you can call eventSource.close();
    console.log("Closing event source.");
    eventSource.close();
}