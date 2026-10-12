import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {PasswordOtpRecovery} from "@/components/password-otp-recovery";
const m=vi.hoisted(()=>({request:vi.fn(),reset:vi.fn(),session:vi.fn(),back:vi.fn()}));
vi.mock("@/api/client",()=>({api:{requestPasswordOtp:m.request,resetPasswordOtp:m.reset}}));
vi.mock("@/lib/session",()=>({setSession:m.session}));
const requestId="a".repeat(64);
function setup(){render(<QueryClientProvider client={new QueryClient()}><PasswordOtpRecovery initialEmail="owner@example.com" onBack={m.back}/></QueryClientProvider>);}
beforeEach(()=>{vi.clearAllMocks();m.request.mockResolvedValue({requestId,delivery:"console",expiresInSeconds:600});m.reset.mockResolvedValue({message:"Updated"});});
afterEach(cleanup);
async function request(){setup();fireEvent.click(screen.getByRole("button",{name:"Request OTP"}));await screen.findByLabelText("6-digit OTP");}
function fill(){fireEvent.change(screen.getByLabelText("6-digit OTP"),{target:{value:"012345"}});fireEvent.change(screen.getByLabelText("New password"),{target:{value:"new-password-123"}});fireEvent.change(screen.getByLabelText("Confirm new password"),{target:{value:"new-password-123"}});}
it("requests an OTP and explains console delivery without exposing a code",async()=>{await request();expect(m.request).toHaveBeenCalledWith("owner@example.com");expect(screen.getByText(/Render server logs/)).toBeInTheDocument();expect(screen.getByLabelText("6-digit OTP")).toHaveValue("");});
it("submits the request reference, OTP and matching password, then clears sessions",async()=>{await request();fill();fireEvent.click(screen.getByRole("button",{name:"Update password"}));await screen.findByText("Password updated");expect(m.reset).toHaveBeenCalledWith(requestId,"012345","new-password-123");expect(m.session).toHaveBeenCalledWith(null);});
it("blocks mismatched passwords and displays invalid OTP errors",async()=>{await request();fill();fireEvent.change(screen.getByLabelText("Confirm new password"),{target:{value:"different-password"}});expect(screen.getByRole("button",{name:"Update password"})).toBeDisabled();fireEvent.change(screen.getByLabelText("Confirm new password"),{target:{value:"new-password-123"}});m.reset.mockRejectedValue(new Error("OTP is invalid or expired"));fireEvent.click(screen.getByRole("button",{name:"Update password"}));expect(await screen.findByRole("alert")).toHaveTextContent("OTP is invalid or expired");expect(m.session).not.toHaveBeenCalled();});
it("resend clears the old OTP and uses the new reference",async()=>{await request();fill();m.request.mockResolvedValue({requestId:"b".repeat(64),delivery:"smtp",expiresInSeconds:600});fireEvent.click(screen.getByRole("button",{name:"Request new OTP"}));await waitFor(()=>expect(screen.getByLabelText("6-digit OTP")).toHaveValue(""));expect(screen.getByText(/check your email/)).toBeInTheDocument();fireEvent.change(screen.getByLabelText("6-digit OTP"),{target:{value:"543210"}});fireEvent.click(screen.getByRole("button",{name:"Update password"}));await waitFor(()=>expect(m.reset).toHaveBeenCalledWith("b".repeat(64),"543210","new-password-123"));});
