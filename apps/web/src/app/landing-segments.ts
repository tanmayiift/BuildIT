import record from "./track-record.json";

// Four kinds of team read this page and they disagree on nearly everything commercial - budget,
// who signs off, what "fast" means. What they share is the reason they distrust AI review: it
// asserts what it cannot back. So the hero makes that one claim, and each block below is a way into
// the same evidence for the question that segment asks first, not a separate pitch.
//
// Every sentence is checked against the code that makes it true. The open-source answer in
// particular is only true since reviewPolicy refused automatic and below-write reviews of forks;
// before that, automatic review let anyone spend the maintainer's key by opening pull requests.
export const landingSegments = [
  { who: "Startup teams", question: "Will we act on what it says?",
    answer: `${record.decisive} of ${record.reviews} reviews so far ended in a verdict you can act on, and a fix, when you ask for one, arrives as a stacked pull request you merge.`,
    href: "/proof#verdict-mix", link: "See every verdict it reached" },
  { who: "Scale-ups", question: "Will security sign off on it?",
    answer: "Source travels only as short-lived encrypted artifacts, four roles separate reading, reviewing and changing limits, and a hash-chained audit log shows any edit.",
    href: "/data-handling", link: "Read the data boundary" },
  { who: "Solo developers", question: "What will it cost me?",
    answer: "You bring your own model key and pay your provider at cost, BuildIT adds nothing on top, and one repository is enough to start.",
    href: "/pricing", link: "See what you pay" },
  { who: "Open-source maintainers", question: "Can a stranger’s pull request spend my key?",
    answer: "No. A fork is reviewed only when a maintainer with write access asks — never automatically, and never with a fix pushed to it.",
    href: "/features#forks", link: "How forks are handled" },
] as const;
