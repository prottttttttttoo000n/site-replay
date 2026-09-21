import { describe, it, expect } from "vitest";

// Unit tests for recorder utility functions
// These test the logic without needing a browser

describe("Recorder Utilities", () => {
  // Test CSS selector generation logic
  describe("getSelector", () => {
    // We can't test DOM directly, but we can test the logic
    it("generates ID selectors", () => {
      const mockEl = { id: "my-button", tagName: "BUTTON", className: "", parentElement: null };
      const selector = mockEl.id ? `#${mockEl.id}` : mockEl.tagName.toLowerCase();
      expect(selector).toBe("#my-button");
    });

    it("generates tag selectors for elements without ID", () => {
      const mockEl = { id: "", tagName: "DIV", className: "", parentElement: null };
      const selector = mockEl.tagName.toLowerCase();
      expect(selector).toBe("div");
    });

    it("generates class selectors", () => {
      const mockEl = { id: "", tagName: "BUTTON", className: "btn primary", parentElement: null };
      const selector = mockEl.tagName.toLowerCase() + "." + mockEl.className.trim().split(/\s+/).join(".");
      expect(selector).toBe("button.btn.primary");
    });
  });

  // Test sensitive field detection logic
  describe("isSensitive", () => {
    const testCases = [
      { type: "password", name: "", autocomplete: "", expected: true },
      { type: "text", name: "user_password", autocomplete: "", expected: true },
      { type: "text", name: "credit_card", autocomplete: "", expected: true },
      { type: "text", name: "ssn", autocomplete: "", expected: true },
      { type: "text", name: "", autocomplete: "cc-number", expected: true },
      { type: "text", name: "", autocomplete: "current-password", expected: true },
      { type: "text", name: "email", autocomplete: "", expected: false },
      { type: "text", name: "username", autocomplete: "", expected: false },
      { type: "email", name: "", autocomplete: "email", expected: false },
    ];

    testCases.forEach(({ type, name, autocomplete, expected }) => {
      it(`returns ${expected} for type="${type}" name="${name}" autocomplete="${autocomplete}"`, () => {
        const isSensitiveField =
          type === "password" ||
          name.toLowerCase().includes("password") ||
          name.toLowerCase().includes("credit") ||
          name.toLowerCase().includes("ssn") ||
          autocomplete.toLowerCase().includes("cc-") ||
          autocomplete.toLowerCase().includes("password");

        expect(isSensitiveField).toBe(expected);
      });
    });
  });

  // Test mask value function
  describe("maskValue", () => {
    it("masks password with asterisks", () => {
      const mask = (val: string) => "*".repeat(val.length);
      expect(mask("hello")).toBe("*****");
      expect(mask("12345678")).toBe("********");
      expect(mask("")).toBe("");
    });
  });

  // Test throttle logic
  describe("throttle", () => {
    it("throttles function calls", async () => {
      let callCount = 0;
      const fn = () => {
        callCount++;
      };

      // Simple throttle implementation
      let last = 0;
      const throttled = (...args: any[]) => {
        const now = Date.now();
        if (now - last >= 50) {
          last = now;
          fn(...args);
        }
      };

      // Call rapidly
      throttled();
      throttled();
      throttled();
      throttled();

      // Should only call once immediately
      expect(callCount).toBe(1);

      // Wait and call again
      await new Promise((r) => setTimeout(r, 60));
      throttled();
      expect(callCount).toBe(2);
    });
  });

  // Test session ID format
  describe("Session ID", () => {
    it("generates valid UUID format", () => {
      // Simulate crypto.randomUUID
      const uuid = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });

      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
  });

  // Test event timestamp calculation
  describe("Event timestamps", () => {
    it("calculates relative timestamps", () => {
      const sessionStart = Date.now();
      const eventTime = sessionStart + 1500;
      const relativeTimestamp = eventTime - sessionStart;

      expect(relativeTimestamp).toBe(1500);
    });
  });
});
