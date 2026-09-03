// Files served straight out of apps/web/public. The Edge proxy answers a real 404 for any path it
// does not know, and it knew only routes - so the social card it was asked to advertise came back
// 404 from production while the meta tag pointed at it. Listing them rather than matching on a file
// extension keeps an unshipped /anything.png a genuine 404; a test asserts this list is exactly the
// directory contents, because the drift is what broke it.
export const publicAssets = ["/social-card.png", "/mark.svg"] as const;
