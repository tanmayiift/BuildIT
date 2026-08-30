import type {ReactNode} from "react";

type ActionLinkProps={href:string;children:ReactNode;priority?:"primary"|"secondary"|"tertiary";size?:"default"|"compact";external?:boolean;className?:string;label?:string};
export function ActionLink({href,children,priority="primary",size="default",external=false,className="",label}:ActionLinkProps){return <a className={`action action-${priority} action-${size} ${className}`.trim()} href={href} aria-label={label} {...(external?{target:"_blank",rel:"noreferrer"}:{})}>{children}{external?<span className="action-external" aria-hidden="true">↗</span>:null}</a>}
