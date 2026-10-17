import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Field, NativeSelect } from "@/components/app/form-bits";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
afterEach(cleanup);
describe("Field accessible associations", () => {
  it("names inputs and connects validation and hints without replacing existing descriptions", () => {
    render(<><Field label="Driver name" hint="Full name"><Input /></Field><Field label="Name" error="Required"><Input id="party-name" aria-describedby="existing" /></Field><p id="existing">Party identity</p><Field label="Notes"><Textarea /></Field></>);
    expect(screen.getByRole("textbox", { name: "Driver name" })).toHaveAccessibleDescription("Full name");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveAttribute("id", "party-name");
    expect(screen.getByLabelText("Name")).toHaveAccessibleDescription("Party identity Required");
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Notes")).toHaveRole("textbox");
  });
  it("keeps repeated labels unique and forwards the target through searchable selects", () => {
    render(<><Field label="Date"><Input type="date" /></Field><Field label="Date"><Input type="date" /></Field><Field label="Customer" hint="Active customers"><NativeSelect defaultValue=""><option value="">Choose customer</option><option value="c1">QA party</option></NativeSelect></Field><Field label="Warehouse"><NativeSelect><option>Yard</option></NativeSelect></Field></>);
    const dates = screen.getAllByLabelText("Date");
    expect(dates[0]!.id).not.toBe(dates[1]!.id);
    expect(screen.getByLabelText("Customer")).toHaveRole("combobox");
    expect(screen.getByLabelText("Customer")).toHaveAccessibleDescription("Active customers");
    expect(screen.getByLabelText("Warehouse")).toHaveRole("combobox");
  });
});
