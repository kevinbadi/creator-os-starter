/**
 * Instantly API v2 Client
 * Base URL: https://api.instantly.ai/api/v2
 * Auth: Bearer token
 */

const API_BASE = 'https://api.instantly.ai/api/v2';

class InstantlyAPI {
  constructor(apiKey) {
    this.apiKey = apiKey;
    if (!apiKey) {
      throw new Error('INSTANTLY_API_KEY is required');
    }
  }

  async request(method, endpoint, body = null) {
    const url = `${API_BASE}${endpoint}`;
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Instantly API error: ${JSON.stringify(data)}`);
    }

    return data;
  }

  // Campaign endpoints
  async listCampaigns(limit = 100, skip = 0) {
    const response = await this.request('GET', `/campaigns?limit=${limit}&skip=${skip}`);
    return response?.items || response || [];
  }

  async getCampaign(id) {
    return this.request('GET', `/campaigns/${id}`);
  }

  async createCampaign(campaign) {
    return this.request('POST', '/campaigns', campaign);
  }

  async updateCampaign(id, updates) {
    return this.request('PATCH', `/campaigns/${id}`, updates);
  }

  async deleteCampaign(id) {
    return this.request('DELETE', `/campaigns/${id}`);
  }

  async activateCampaign(id) {
    return this.request('POST', `/campaigns/${id}/activate`);
  }

  async pauseCampaign(id) {
    return this.request('POST', `/campaigns/${id}/pause`);
  }

  async getCampaignAnalytics(campaignIds = []) {
    const ids = campaignIds.join(',');
    return this.request('GET', `/campaigns/analytics${ids ? `?campaign_ids=${ids}` : ''}`);
  }

  // Lead endpoints
  async createLead(campaignId, lead) {
    return this.request('POST', '/leads', {
      campaign: campaignId,
      ...lead,
    });
  }

  async createLeadsBatch(campaignId, leads) {
    return this.request('POST', '/leads/batch', {
      campaign: campaignId,
      leads,
    });
  }

  async getLead(id) {
    return this.request('GET', `/leads/${id}`);
  }

  async listLeads(campaignId, limit = 100, skip = 0) {
    return this.request('GET', `/leads?campaign=${campaignId}&limit=${limit}&skip=${skip}`);
  }

  async deleteLead(id) {
    return this.request('DELETE', `/leads/${id}`);
  }

  // Email account endpoints
  async listEmailAccounts(limit = 100, skip = 0) {
    const response = await this.request('GET', `/accounts?limit=${limit}&skip=${skip}`);
    return response?.items || response || [];
  }

  async getEmailAccount(email) {
    return this.request('GET', `/accounts/${email}`);
  }
}

module.exports = { InstantlyAPI };
