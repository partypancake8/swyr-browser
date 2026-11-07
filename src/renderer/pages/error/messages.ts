// Plain-language explanations for Chromium net error codes, shown by swyr://error.

export interface ErrorCopy {
  title: string
  detail: (host: string) => string
}

const offline: ErrorCopy = {
  title: "You're offline",
  detail: () => "swyr can't reach the internet right now. Check your Wi-Fi or network cable, then try again."
}
const unreachable: ErrorCopy = {
  title: "swyr can't reach this site",
  detail: (h) => `${h} isn't answering. The site may be down, or your network may be blocking it.`
}

const BY_CODE: Record<number, ErrorCopy> = {
  [-102]: { title: "swyr can't reach this site", detail: (h) => `${h} refused to connect. Nothing is listening at that address, or it is turning visitors away.` },
  [-105]: { title: "swyr can't find this site", detail: (h) => `The address ${h} could not be found. Check the spelling, or search for the site instead.` },
  [-137]: { title: "swyr can't find this site", detail: (h) => `The address ${h} could not be looked up. Your DNS server may be having trouble.` },
  [-106]: offline,
  [-21]: { title: 'Your network changed', detail: () => 'The connection dropped while the page was loading. Try again once you are back online.' },
  [-109]: unreachable,
  [-118]: { title: 'This site took too long to respond', detail: (h) => `${h} did not answer in time. It may be busy, or your connection may be slow.` },
  [-7]: { title: 'This site took too long to respond', detail: (h) => `${h} did not answer in time.` },
  [-101]: { title: 'The connection was reset', detail: (h) => `The connection to ${h} was cut off partway through.` },
  [-100]: { title: 'The connection was closed', detail: (h) => `${h} closed the connection unexpectedly.` },
  [-324]: { title: "This page didn't send anything", detail: (h) => `${h} closed the connection without sending any data.` },
  [-310]: { title: 'This page keeps redirecting', detail: (h) => `${h} redirected too many times. Clearing its cookies sometimes fixes this.` },
  [-300]: { title: 'That address is not valid', detail: () => 'swyr could not understand that web address.' },
  [-20]: { title: 'This page was blocked', detail: (h) => `swyr's ad blocker stopped ${h} from loading. Allow ads on this site to open it.` },
  [-27]: { title: 'This page was blocked', detail: (h) => `${h} refused to be shown here.` },
  [-312]: { title: "swyr can't open this port", detail: (h) => `${h} uses a port reserved for other kinds of traffic, so browsers refuse to load web pages from it.` },
  [-6]: { title: "swyr can't find this file", detail: () => 'The file may have been moved, renamed or deleted.' },
  [-10]: { title: "swyr can't open this page", detail: () => 'Access to this page was denied.' }
}

export function errorCopy(code: number): ErrorCopy {
  if (BY_CODE[code]) return BY_CODE[code]
  if (code <= -200 && code > -300) {
    return { title: "This connection isn't private", detail: (h) => `swyr could not verify ${h}'s security certificate, so the page was not loaded.` }
  }
  return { title: "swyr can't open this page", detail: (h) => `Loading ${h || 'this page'} failed.` }
}
