import type {ReactNode} from "react";

// A link that looks like a button. It used to emit its own .action / .action-primary / .action-compact
// classes - a second button system beside .button, with its own hover, padding and compact size,
// drifting from the first. It now emits .button and its modifiers, so there is one button.
type ActionLinkProps={href:string;children:ReactNode;priority?:"primary"|"secondary"|"tertiary";size?:"default"|"compact";external?:boolean;className?:string;label?:string};
export function ActionLink({href,children,priority="primary",size="default",external=false,className="",label}:ActionLinkProps){
  const classes=["button",priority==="primary"?"":priority,size==="compact"?"compact":"",className].filter(Boolean).join(" ");
  return <a className={classes} href={href} aria-label={label} {...(external?{target:"_blank",rel:"noreferrer"}:{})}>{children}{external?<span className="button-external" aria-hidden="true">↗</span>:null}</a>;
}
