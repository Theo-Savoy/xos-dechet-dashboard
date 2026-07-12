import { describe, expect, it } from "vitest";
import { createDialerLogQueue } from "./dialerLogQueue";

describe("createDialerLogQueue", () => {
  it("runs tasks in order without dropping any", async () => {
    const order: number[] = [];
    const queue = createDialerLogQueue();
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    queue.enqueue(async () => {
      await firstGate;
      order.push(1);
    });
    queue.enqueue(async () => {
      order.push(2);
    });
    queue.enqueue(async () => {
      order.push(3);
    });

    expect(queue.getPending()).toBe(3);
    expect(order).toEqual([]);

    releaseFirst();
    await queue.whenIdle();
    expect(order).toEqual([1, 2, 3]);
    expect(queue.getPending()).toBe(0);
  });

  it("keeps draining after a task failure", async () => {
    const order: number[] = [];
    const queue = createDialerLogQueue();

    queue.enqueue(async () => {
      order.push(1);
      throw new Error("boom");
    });
    queue.enqueue(async () => {
      order.push(2);
    });

    await queue.whenIdle();
    expect(order).toEqual([1, 2]);
  });

  it("notifies pending count changes", async () => {
    const counts: number[] = [];
    const queue = createDialerLogQueue((n) => counts.push(n));
    queue.enqueue(async () => {
      await Promise.resolve();
    });
    await queue.whenIdle();
    expect(counts[0]).toBe(1);
    expect(counts[counts.length - 1]).toBe(0);
  });
});
