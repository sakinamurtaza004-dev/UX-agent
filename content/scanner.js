// CONTENT SCRIPT
// This code is injected INTO the web page the user is looking at,
// so it can read the page's DOM. It looks, counts, and reports back.
(() => {
  const all = document.querySelectorAll("*");
  const images = [...document.images];
  return {
    url: location.href,
    title: document.title || "(no title)",
    totalElements: all.length,
    headings: document.querySelectorAll("h1,h2,h3,h4,h5,h6").length,
    h1Count: document.querySelectorAll("h1").length,
    links: document.links.length,
    buttons: document.querySelectorAll("button,[role='button'],input[type='submit']").length,
    images: images.length,
    imagesMissingAlt: images.filter(i => !i.hasAttribute("alt")).length,
  };
})();
