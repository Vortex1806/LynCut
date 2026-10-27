let shuttingdown = false;

export function beginShutdown(): void {
    shuttingdown = true;
}

export function isShuttingDown(): boolean {
    return shuttingdown;
}