import {createFileRoute} from "@tanstack/react-router";
import {CaWorkspace} from "@/components/ca-workspace";
export const Route=createFileRoute("/_authenticated/ca")({head:()=>({meta:[{title:"Chartered Accountant — Girder"},{name:"robots",content:"noindex"}]}),component:CaWorkspace});
