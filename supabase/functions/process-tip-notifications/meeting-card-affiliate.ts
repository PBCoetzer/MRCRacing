export const betfredAffiliateUrl =
  "https://betfredsa.click/o/jYTCha?lpage=pzQ7HH&site_id=1225&r_id=132";

export const betfredBannerUrl =
  "https://raven1-bettingworldaffiliates-uploads-bucket.s3.eu-west-1.amazonaws.com/campaign-public/resources/banner/images/img_108_1788789967.png";

export type MeetingCardAffiliateFooter = {
  html: string;
  text: string;
};

export function buildMeetingCardAffiliateFooter(): MeetingCardAffiliateFooter {
  return {
    text: `Create your Betfred account now: ${betfredAffiliateUrl}\n` +
      "18+. Please gamble responsibly. Terms and conditions apply. MRC Racing Tips may receive a commission.",
    html:
      `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:#ffffff;border:2px solid #e30613;border-radius:14px;overflow:hidden">
      <tr>
        <td align="center" style="padding:20px 18px 12px">
          <div style="margin:0 0 12px;color:#101820;font-size:22px;line-height:1.2;font-weight:800">Ready to back your selections?</div>
          <a href="${betfredAffiliateUrl}" target="_blank" style="display:block;text-decoration:none">
            <img src="${betfredBannerUrl}" width="520" alt="Betfred South Africa" style="display:block;width:100%;max-width:520px;height:auto;margin:0 auto;border:0">
          </a>
        </td>
      </tr>
      <tr>
        <td align="center" style="padding:6px 18px 18px">
          <a href="${betfredAffiliateUrl}" target="_blank" style="display:inline-block;min-width:260px;background:#e30613;color:#ffffff;text-decoration:none;text-align:center;font-size:18px;line-height:1.2;font-weight:800;padding:15px 24px;border-radius:9px">CREATE ACCOUNT NOW</a>
          <div style="margin-top:12px;color:#4b5563;font-size:11px;line-height:1.5"><strong>18+.</strong> Please gamble responsibly. Terms and conditions apply.<br>MRC Racing Tips may receive a commission when you use this link.</div>
        </td>
      </tr>
    </table>`,
  };
}
