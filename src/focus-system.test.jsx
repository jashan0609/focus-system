import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import FocusSystem from "../focus-system.jsx";

describe("FocusSystem", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders app shell and default timer state", () => {
    render(<FocusSystem />);

    expect(screen.getByText("Focus")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Timer" })).toBeInTheDocument();
    expect(screen.getByText("30:00")).toBeInTheDocument();
    expect(screen.getByLabelText("Focus task")).toBeInTheDocument();
  });

  it("loads stats and sessions from localStorage", () => {
    localStorage.setItem(
      "focus-sessions",
      JSON.stringify([
        { id: 1, date: "2026-05-09", dur: 25, task: "Ship", time: "10:00" },
      ])
    );
    localStorage.setItem(
      "focus-stats",
      JSON.stringify({ total: 12, mins: 250, bestDay: 5, streak: 3 })
    );

    render(<FocusSystem />);

    expect(screen.getAllByText("12").length).toBeGreaterThan(0);
    expect(screen.getByText("4.2")).toBeInTheDocument();
  });

  it("moves intention into task when going from prep to timer", () => {
    render(<FocusSystem />);

    fireEvent.click(screen.getAllByRole("button", { name: "Pre-session" })[0]);
    const intentionInput = screen.getByPlaceholderText(
      'e.g. "Build the booking form for the beauty parlour app"'
    );
    fireEvent.change(intentionInput, { target: { value: "Finish deploy checklist" } });

    fireEvent.click(screen.getByRole("button", { name: /Ready/i }));

    expect(screen.getByLabelText("Focus task")).toHaveValue("Finish deploy checklist");
  });

  it("adds custom focus preset", () => {
    render(<FocusSystem />);

    fireEvent.click(screen.getAllByRole("button", { name: /Edit presets/i })[0]);
    fireEvent.click(screen.getByTitle("Add custom focus time"));

    const input = screen.getByPlaceholderText("min");
    fireEvent.change(input, { target: { value: "40" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByRole("button", { name: "40m" })).toBeInTheDocument();
  });

  it("clears history and stats", () => {
    localStorage.setItem(
      "focus-sessions",
      JSON.stringify([
        { id: 1, date: "2026-05-09", dur: 25, task: "Ship", time: "10:00" },
      ])
    );
    localStorage.setItem(
      "focus-stats",
      JSON.stringify({ total: 2, mins: 50, bestDay: 2, streak: 1 })
    );

    render(<FocusSystem />);
    fireEvent.click(screen.getAllByRole("button", { name: "History" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));

    expect(screen.getByText("No sessions today — start your first one.")).toBeInTheDocument();
    expect(localStorage.getItem("focus-sessions")).toBeNull();
    expect(localStorage.getItem("focus-stats")).toBeNull();
  });
});
