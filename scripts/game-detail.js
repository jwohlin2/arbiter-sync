/**
 * Scrapes a single Arbiter game detail page.
 * Expects an already-open Playwright page with an authenticated session.
 */

async function scrapeGameDetail(page, groupId, gameId) {
  const url = `https://www1.arbitersports.com/Official/GameView.aspx?groupID=${groupId}&gameID=${gameId}&userID=`;

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

  return await page.evaluate(() => {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const bodyText = document.body.innerText;

    // Split page text into sections by known Arbiter headings
    const assignerStart = bodyText.search(/Your slot was assigned by:/i);
    const paidByStart   = bodyText.search(/Your game is paid by:/i);
    // Some pages use "School Contacts" instead of / in addition to "paid by"
    const schoolStart   = bodyText.search(/School Contacts?:/i);

    const officialSection = bodyText.slice(
      0,
      assignerStart > -1 ? assignerStart : bodyText.length
    );

    const hostSectionStart = paidByStart > -1 ? paidByStart
      : schoolStart > -1 ? schoolStart
      : -1;
    const hostSection = hostSectionStart > -1 ? bodyText.slice(hostSectionStart) : '';

    function extractEmails(text) {
      return [...new Set((text.match(emailRegex) || []).map(e => e.toLowerCase()))];
    }

    function extractContactName(text) {
      if (!text) return '';
      // Name is on the same line as the email, to its left
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (!emailRegex.test(line)) continue;
        const beforeEmail = line.slice(0, line.search(emailRegex)).trim();
        if (/^[A-Z][a-z]+ [A-Z]/.test(beforeEmail) && beforeEmail.length < 60) {
          return beforeEmail;
        }
      }
      return '';
    }

    return {
      crewEmails:  extractEmails(officialSection),
      hostEmails:  extractEmails(hostSection),
      contactName: extractContactName(hostSection)
    };
  });
}

function parseGameId(id) {
  const parts = String(id).split(',');
  return { groupId: parts[0], gameId: parts[1] };
}

module.exports = { scrapeGameDetail, parseGameId };
