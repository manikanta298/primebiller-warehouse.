import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {DeleteRecordButton} from "@/components/app/DeleteRecordButton";
const m=vi.hoisted(()=>({role:"Owner",orgId:"org1",deleteRecord:vi.fn(),updateSession:vi.fn(),success:vi.fn(),error:vi.fn()}));
vi.mock("@/api/client",()=>({api:{deleteRecord:m.deleteRecord}}));
vi.mock("@/lib/session",()=>({useSession:()=>({user:{role:m.role}}),getSession:()=>({orgId:m.orgId,godownId:"g1"}),updateSession:m.updateSession}));
vi.mock("sonner",()=>({toast:{success:m.success,error:m.error}}));
function setup(){render(<QueryClientProvider client={new QueryClient()}><DeleteRecordButton kind="warehouses" id="g1" name="Test Warehouse" orgId="org1" /></QueryClientProvider>);}
beforeEach(()=>{vi.clearAllMocks();m.role="Owner";m.orgId="org1";m.deleteRecord.mockResolvedValue({deleted:true,id:"g1"});});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it("requires confirmation and sends the scoped delete once",async()=>{vi.spyOn(window,"confirm").mockReturnValue(true);setup();fireEvent.click(screen.getByRole("button",{name:"Delete Test Warehouse"}));await waitFor(()=>expect(m.deleteRecord).toHaveBeenCalledExactlyOnceWith("warehouses","g1","org1"));await waitFor(()=>expect(m.updateSession).toHaveBeenCalledWith({godownId:"all"}));});
it("declining confirmation preserves the record",()=>{vi.spyOn(window,"confirm").mockReturnValue(false);setup();fireEvent.click(screen.getByRole("button",{name:"Delete Test Warehouse"}));expect(m.deleteRecord).not.toHaveBeenCalled();});
it("Sales cannot see the destructive action",()=>{m.role="Sales";setup();expect(screen.queryByRole("button")).toBeNull();});
it("reports a referenced-record rejection without clearing the selected warehouse",async()=>{m.deleteRecord.mockRejectedValue(new Error("This record is used by existing documents"));vi.spyOn(window,"confirm").mockReturnValue(true);setup();fireEvent.click(screen.getByRole("button",{name:"Delete Test Warehouse"}));await waitFor(()=>expect(m.error).toHaveBeenCalledWith("This record is used by existing documents"));expect(m.updateSession).not.toHaveBeenCalled();});
