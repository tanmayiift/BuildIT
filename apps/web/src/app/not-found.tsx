// Reached through the Edge proxy, which sets the 404 status before the shell streams. Without
// this file the visitor gets Next's default page, which does not sound like the product.
export default function NotFound() {
  return <div className="content">
    <h1 className="title">That page does not exist</h1>
    <p>The address you followed is not a BuildIT page. It may have been renamed, or the link may be wrong.</p>
    <div className="button-row">
      <a className="text-link" href="/">Go to the overview</a>
      <a className="text-link" href="/reviews">Open the review queue</a>
    </div>
  </div>;
}
