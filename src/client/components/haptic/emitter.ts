/** Minimal synchronous event fan-out. */
export class Emitter<T = void> {
    private readonly listeners: Array<(value: T) => void> = [];

    on(listener: (value: T) => void): void {
        this.listeners.push(listener);
    }

    emit(value: T): void {
        for (const listener of this.listeners) listener(value);
    }
}
