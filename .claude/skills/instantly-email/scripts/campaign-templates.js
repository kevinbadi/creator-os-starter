/**
 * Email Campaign Templates for Kev Builds Apps / Creator Claw
 * 3 Campaigns: VCs, AI YouTubers (Podcast), Creator Claw Leads
 */

const BOOKING_LINK = 'https://calendly.com/creator_os/creator-os-discovery-call';

const SIGNATURE = `
Kev Badi
Founder, Creator Claw
https://www.skool.com/kevs-no-code-academy-3295/about`;

const CAMPAIGNS = {
  vc: {
    name: 'Creator Claw - VC Outreach',
    description: 'Venture capital firms and angel investors',
    category_match: ['vc', 'venture', 'investor', 'capital', 'fund'],
    sequences: [
      {
        steps: [
          {
            type: 'email',
            delay: 0,
            delay_unit: 'days',
            variants: [
              {
                subject: 'AI Operating Systems for Creators — Creator Claw',
                body: `Hey {{firstName}},

I'm building Creator Claw — an AI Operating System that automates the entire creator workflow: content repurposing, social engagement, lead gen, and outreach.

Think of it as an AI employee that runs 24/7 — posting, responding to DMs, scraping leads, and booking calls. All while the creator focuses on making content.

We're seeing early traction with creators and agencies who want to scale without hiring.

Would love to share more if this is in your wheelhouse. Open to a quick call?

${BOOKING_LINK}
${SIGNATURE}`,
              },
            ],
          },
          {
            type: 'email',
            delay: 3,
            delay_unit: 'days',
            variants: [
              {
                subject: 'Re: Creator Claw — quick follow up',
                body: `Hey {{firstName}},

Just bumping this up — wanted to see if Creator Claw caught your eye.

We're automating what creators currently spend 20+ hours/week doing manually. The AI handles content distribution, engagement, and lead gen autonomously.

Happy to walk you through a quick demo if helpful.

${BOOKING_LINK}
${SIGNATURE}`,
              },
            ],
          },
          {
            type: 'email',
            delay: 4,
            delay_unit: 'days',
            variants: [
              {
                subject: 'Last note — Creator Claw',
                body: `Hey {{firstName}},

Last follow up on this — I know you're busy.

If AI-powered creator tools aren't on your radar right now, no worries. But if you want to see how we're automating the full creator workflow, I'm happy to show you.

Either way, appreciate your time.

${BOOKING_LINK}
${SIGNATURE}`,
              },
            ],
          },
        ],
      },
    ],
  },

  podcast: {
    name: 'Creator Claw - AI YouTuber Podcast Outreach',
    description: 'AI YouTubers and podcast hosts for guest appearances',
    category_match: ['podcast', 'youtube', 'creator', 'influencer', 'host'],
    sequences: [
      {
        steps: [
          {
            type: 'email',
            delay: 0,
            delay_unit: 'days',
            variants: [
              {
                subject: 'Guest pitch: I built an AI that runs my entire creator business',
                body: `Hey {{firstName}},

Big fan of your content — especially how you break down AI tools for creators.

I built something I think your audience would love: an AI Operating System that automates content repurposing, social engagement, DM outreach, and lead gen — all running autonomously.

Basically, I have an AI employee that posts for me, responds to comments/DMs, scrapes leads, and books calls. 24/7.

Would love to come on and share how I built it, the tech stack, and how creators can set up their own AI OS.

Open to hopping on a quick call to coordinate?

${BOOKING_LINK}
${SIGNATURE}`,
              },
            ],
          },
          {
            type: 'email',
            delay: 4,
            delay_unit: 'days',
            variants: [
              {
                subject: 'Re: AI Operating System for Creators — guest idea',
                body: `Hey {{firstName}},

Just following up on my guest pitch — I think the "AI employee running your creator business" angle could be a banger episode.

Happy to tailor the topic to whatever resonates with your audience. Some angles:
- How I automated 20+ hours/week of creator work
- Building an AI that DMs, posts, and books calls for you
- The no-code stack behind an AI Operating System

Let me know if you're interested — would love to coordinate.

${BOOKING_LINK}
${SIGNATURE}`,
              },
            ],
          },
          {
            type: 'email',
            delay: 5,
            delay_unit: 'days',
            variants: [
              {
                subject: 'Last bump — AI creator episode',
                body: `Hey {{firstName}},

Last note on this — I know inboxes get crazy.

If you're ever looking for a guest who can break down AI automation for creators in a practical way, I'm your guy. Built the whole system myself and happy to share the sauce.

Either way, keep killing it with your content 🤙

${SIGNATURE}`,
              },
            ],
          },
        ],
      },
    ],
  },

  creatorclaw: {
    name: 'Creator Claw - B2B Leads',
    description: 'B2B SaaS, Startups, Software companies, Marketing Agencies',
    category_match: ['saas', 'startup', 'software', 'agency', 'marketing', 'b2b'],
    sequences: [
      {
        steps: [
          {
            type: 'email',
            delay: 0,
            delay_unit: 'days',
            variants: [
              {
                subject: 'AI that handles your social + outreach — Creator Claw',
                body: `Hey {{firstName}},

Quick question — how much time does your team spend on social media, content repurposing, and outbound outreach?

I built Creator Claw, an AI Operating System that automates:
- Content repurposing across all platforms
- Social engagement (comments, DMs)
- Lead scraping and enrichment
- Cold outreach at scale

It's like hiring an AI employee that works 24/7 — without the overhead.

We're working with startups and agencies who want to scale their content and outreach without adding headcount.

Worth a quick call to see if it fits?

${BOOKING_LINK}
${SIGNATURE}`,
              },
            ],
          },
          {
            type: 'email',
            delay: 3,
            delay_unit: 'days',
            variants: [
              {
                subject: 'Re: AI Operating System for {{companyName}}',
                body: `Hey {{firstName}},

Following up on Creator Claw — just wanted to see if automating your social and outreach is on your radar.

Most teams I talk to are spending 10-20 hours/week on stuff that AI can handle. We help them get that time back while actually increasing output.

Happy to show you how it works in a quick call.

${BOOKING_LINK}
${SIGNATURE}`,
              },
            ],
          },
          {
            type: 'email',
            delay: 4,
            delay_unit: 'days',
            variants: [
              {
                subject: 'Last note — Creator Claw demo',
                body: `Hey {{firstName}},

Last follow up on this — if automating content and outreach isn't a priority right now, totally get it.

But if you want to see how an AI Operating System can run your social, engagement, and outreach on autopilot, I'm happy to show you.

Either way, appreciate your time.

${BOOKING_LINK}
${SIGNATURE}`,
              },
            ],
          },
        ],
      },
    ],
  },
};

// Helper to match email_campaign column to Instantly campaign
function matchCategoryToCampaign(emailCampaign) {
  if (!emailCampaign) return null;
  
  const campaign = emailCampaign.toLowerCase();
  
  if (CAMPAIGNS[campaign]) {
    return campaign;
  }
  
  return null;
}

module.exports = { CAMPAIGNS, matchCategoryToCampaign, SIGNATURE, BOOKING_LINK };
