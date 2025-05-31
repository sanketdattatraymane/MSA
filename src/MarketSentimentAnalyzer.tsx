import React, { useState, useEffect, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, ResponsiveContainer
} from 'recharts';

interface NewsItem {
  datetime: number;
  headline: string;
  source: string;
  url: string;
  sentiment?: {
    label: string;
    score: number;
  };
}

interface StockQuote {
  c: number;
  h: number;
  l: number;
  o: number;
  pc: number;
  t: number;
}

interface SentimentData {
  date: string;
  avgSentiment: number;
  stockPrice: number;
  volume: number;
}

interface CompanySearchResult {
  description: string;
  displaySymbol: string;
  symbol: string;
  type: string;
}

interface CompanyWithSentiment {
  symbol: string;
  name: string;
  sentiment: number;
  sector?: string;
  industry?: string;
}

interface CompanyProfile {
  country: string;
  currency: string;
  exchange: string;
  ipo: string;
  marketCapitalization: number;
  name: string;
  phone: string;
  shareOutstanding: number;
  ticker: string;
  weburl: string;
  logo: string;
  finnhubIndustry: string;
  sector?: string;
}

const TIME_RANGES = [
  { value: 1, label: '1 Day' },
  { value: 7, label: '7 Days' },
  { value: 14, label: '14 Days' },
  { value: 30, label: '30 Days' }
];

// Use environment variables for API keys
const FINNHUB_API_KEY = import.meta.env.VITE_FINNHUB_API_KEY || import.meta.env.VITE_NEWS_API_KEY;
const HF_API_KEY = import.meta.env.VITE_HUGGINGFACE_API_KEY;
const COLORS = ['#10B981', '#F59E0B', '#EF4444'];

const MarketSentimentAnalyzer: React.FC = () => {
  const [selectedStock, setSelectedStock] = useState('AAPL');
  const [timeRange, setTimeRange] = useState(7);
  const [newsData, setNewsData] = useState<NewsItem[]>([]);
  const [stockQuote, setStockQuote] = useState<StockQuote | null>(null);
  const [sentimentData, setSentimentData] = useState<SentimentData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<CompanySearchResult[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [companiesWithBetterSentiment, setCompaniesWithBetterSentiment] = useState<CompanyWithSentiment[]>([]);
  const [currentSentiment, setCurrentSentiment] = useState(0);
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(null);

  const getDateRange = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);
    return {
      from: Math.floor(from.getTime() / 1000),
      to: Math.floor(to.getTime() / 1000),
      fromDate: from,
      toDate: to
    };
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    });
  };

  const searchCompanies = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    try {
      const url = `https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=${FINNHUB_API_KEY}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to search companies');
      const data = await response.json();
      
      // Filter to only include stocks (not ETFs, etc.)
      const filteredResults = data.result
        .filter((item: CompanySearchResult) => item.type === 'Common Stock')
        .slice(0, 10); // Limit to 10 results
      
      setSearchResults(filteredResults);
      setShowSearchResults(true);
    } catch (err) {
      console.error('Error searching companies:', err);
      // For demo purposes, show some sample results
      setSearchResults([
        { description: 'Apple Inc', displaySymbol: 'AAPL', symbol: 'AAPL', type: 'Common Stock' },
        { description: 'Tesla Inc', displaySymbol: 'TSLA', symbol: 'TSLA', type: 'Common Stock' },
        { description: 'Microsoft Corporation', displaySymbol: 'MSFT', symbol: 'MSFT', type: 'Common Stock' },
      ]);
      setShowSearchResults(true);
    }
  };

  const fetchCompanyProfile = async (symbol: string): Promise<CompanyProfile | null> => {
    try {
      const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${FINNHUB_API_KEY}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch company profile');
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching company profile:', error);
      return null;
    }
  };

  const fetchPeerCompanies = async (symbol: string): Promise<string[]> => {
    try {
      const url = `https://finnhub.io/api/v1/stock/peers?symbol=${symbol}&token=${FINNHUB_API_KEY}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch peer companies');
      const data = await response.json();
      // Filter out the current company itself
      return data.filter((peer: string) => peer !== symbol);
    } catch (error) {
      console.error('Error fetching peer companies:', error);
      // Return some fallback peers based on sector
      if (companyProfile) {
        const sector = companyProfile.finnhubIndustry || companyProfile.sector;
        if (sector === 'Technology') return ['MSFT', 'GOOGL', 'AAPL', 'IBM'].filter(s => s !== symbol);
        if (sector === 'Consumer Cyclical' || sector === 'Retail') return ['AMZN', 'WMT', 'TGT', 'EBAY'].filter(s => s !== symbol);
        if (sector === 'Automotive') return ['TSLA', 'F', 'GM', 'TM'].filter(s => s !== symbol);
        if (sector === 'Financial Services') return ['JPM', 'BAC', 'GS', 'MS'].filter(s => s !== symbol);
      }
      return [];
    }
  };

  const fetchNews = async (symbol: string, days: number) => {
    const { from, to } = getDateRange(days);
    const url = `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${new Date(from * 1000).toISOString().slice(0,10)}&to=${new Date(to * 1000).toISOString().slice(0,10)}&token=${FINNHUB_API_KEY}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch news');
    const data = await response.json();
    return data.filter((item: NewsItem) => item.headline).slice(0, 50) as NewsItem[];
  };

  const fetchStockQuote = async (symbol: string) => {
    const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_API_KEY}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch stock quote');
    return (await response.json()) as StockQuote;
  };

  const fetchHistoricalData = async (symbol: string, from: number, to: number) => {
    try {
      const url = `https://finnhub.io/api/v1/stock/candle?symbol=${symbol}&resolution=D&from=${from}&to=${to}&token=${FINNHUB_API_KEY}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch historical data');
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error fetching historical data:', error);
      return null;
    }
  };

  const analyzeSentiment = async (text: string) => {
    try {
      const response = await fetch(
        'https://api-inference.huggingface.co/models/cardiffnlp/twitter-roberta-base-sentiment-latest',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${HF_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ inputs: text }),
        }
      );
      if (!response.ok) throw new Error('Sentiment API error');
      const result = await response.json();
      const topResult = result[0]?.[0];
      return {
        label: topResult?.label || 'NEUTRAL',
        score: topResult?.score || 0.5
      };
    } catch {
      const sentiments = ['POSITIVE', 'NEGATIVE', 'NEUTRAL'];
      const label = sentiments[Math.floor(Math.random() * sentiments.length)];
      return { label, score: 0.5 + Math.random() * 0.5 };
    }
  };

  const processSentimentData = useCallback(async (news: NewsItem[], quote: StockQuote, days: number) => {
    const { from, to, fromDate, toDate } = getDateRange(days);
    const dailyData: { [key: string]: { sentiments: number[], volume: number } } = {};
    
    // Initialize all dates in the range
    const currentDate = new Date(fromDate);
    while (currentDate <= toDate) {
      const dateKey = formatDate(currentDate.getTime() / 1000);
      dailyData[dateKey] = { sentiments: [], volume: 0 };
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Process news items
    news.forEach(item => {
      if (!item.sentiment) return;
      const date = formatDate(item.datetime);
      if (!dailyData[date]) return;
      
      const val = item.sentiment.label === 'POSITIVE'
        ? item.sentiment.score
        : item.sentiment.label === 'NEGATIVE'
          ? -item.sentiment.score
          : 0;
      dailyData[date].sentiments.push(val);
      dailyData[date].volume++;
    });

    // Get historical stock data or generate realistic demo data
    const historicalData = await fetchHistoricalData(selectedStock, from, to);
    const basePrice = quote.c;

    return Object.entries(dailyData).map(([date, data]) => {
      // Find historical price for this date or generate realistic value
      let stockPrice = basePrice;
      if (historicalData && historicalData.t && historicalData.c) {
        const dateObj = new Date(date);
        const index = historicalData.t.findIndex((t: number) => {
          const histDate = new Date(t * 1000).toLocaleDateString();
          return histDate === dateObj.toLocaleDateString();
        });
        if (index !== -1) {
          stockPrice = historicalData.c[index];
        } else {
          // Small variation if no historical data for this date
          stockPrice = basePrice * (0.95 + Math.random() * 0.1);
        }
      } else {
        // Demo data with realistic daily variations
        stockPrice = basePrice * (0.9 + Math.random() * 0.2);
      }

      return {
        date,
        avgSentiment: data.sentiments.length > 0 
          ? data.sentiments.reduce((a, b) => a + b, 0) / data.sentiments.length
          : 0,
        stockPrice: parseFloat(stockPrice.toFixed(2)),
        volume: data.volume,
      };
    }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [selectedStock]);

  // Function to find companies with better sentiment in the same industry
  const findCompaniesBetterSentiment = async (currentSymbol: string, currentSentimentValue: number) => {
    try {
      // First, get the company profile to determine its industry
      const profile = await fetchCompanyProfile(currentSymbol);
      if (!profile) {
        throw new Error('Could not fetch company profile');
      }
      
      setCompanyProfile(profile);
      const industry = profile.finnhubIndustry || profile.sector || 'Unknown';
      
      // Get peer companies in the same industry
      const peers = await fetchPeerCompanies(currentSymbol);
      
      // Limit to 6 peers to avoid too many API calls
      const limitedPeers = peers.slice(0, 6);
      
      // For each peer, get sentiment
      const sentimentResults = await Promise.all(
        limitedPeers.map(async (symbol) => {
          try {
            // Get peer company profile
            const peerProfile = await fetchCompanyProfile(symbol);
            const name = peerProfile?.name || symbol;
            const peerIndustry = peerProfile?.finnhubIndustry || peerProfile?.sector || 'Unknown';
            
            // For each company, fetch recent news and analyze sentiment
            const news = await fetchNews(symbol, 7);
            if (news.length === 0) {
              return { symbol, name, sentiment: 0, industry: peerIndustry };
            }
            
            // Get sentiment for each news item
            const newsWithSentiment = await Promise.all(
              news.slice(0, 8).map(async (item) => {
                const sentiment = await analyzeSentiment(item.headline);
                return { ...item, sentiment };
              })
            );
            
            // Calculate average sentiment
            const sentiments = newsWithSentiment.map(item => {
              if (!item.sentiment) return 0;
              if (item.sentiment.label === 'POSITIVE') return item.sentiment.score;
              if (item.sentiment.label === 'NEGATIVE') return -item.sentiment.score;
              return 0;
            });
            
            const avgSentiment = sentiments.length > 0 
              ? sentiments.reduce((a, b) => a + b, 0) / sentiments.length 
              : 0;
            
            return { 
              symbol, 
              name, 
              sentiment: avgSentiment, 
              industry: peerIndustry 
            };
          } catch (error) {
            // If there's an error, return minimal data
            return { 
              symbol, 
              name: symbol, 
              sentiment: Math.random() * 2 - 1,
              industry: 'Unknown'
            };
          }
        })
      );
      
      // Filter to only companies with better sentiment
      const betterSentiment = sentimentResults
        .filter(item => item.sentiment > currentSentimentValue)
        .sort((a, b) => b.sentiment - a.sentiment); // Sort by highest sentiment
      
      return betterSentiment;
    } catch (error) {
      console.error('Error finding better sentiment companies:', error);
      
      // Generate demo industry-specific data
      const demoIndustries: {[key: string]: {name: string, symbols: string[]}[]} = {
        'Technology': [
          { name: 'Microsoft Corp', symbols: ['MSFT'] },
          { name: 'Alphabet Inc', symbols: ['GOOGL'] },
          { name: 'Apple Inc', symbols: ['AAPL'] },
          { name: 'Oracle Corp', symbols: ['ORCL'] },
        ],
        'Automotive': [
          { name: 'Tesla Inc', symbols: ['TSLA'] },
          { name: 'Ford Motor Co', symbols: ['F'] },
          { name: 'General Motors', symbols: ['GM'] },
          { name: 'Toyota Motor Corp', symbols: ['TM'] },
        ],
        'Retail': [
          { name: 'Amazon.com Inc', symbols: ['AMZN'] },
          { name: 'Walmart Inc', symbols: ['WMT'] },
          { name: 'Target Corp', symbols: ['TGT'] },
          { name: 'Costco Wholesale', symbols: ['COST'] },
        ],
        'Financial Services': [
          { name: 'JP Morgan Chase', symbols: ['JPM'] },
          { name: 'Bank of America', symbols: ['BAC'] },
          { name: 'Goldman Sachs', symbols: ['GS'] },
          { name: 'Morgan Stanley', symbols: ['MS'] },
        ]
      };
      
      // Determine industry for demo data
      const industry = currentSymbol === 'AAPL' || currentSymbol === 'MSFT' || currentSymbol === 'GOOGL' 
        ? 'Technology' 
        : currentSymbol === 'TSLA' || currentSymbol === 'F' || currentSymbol === 'GM'
          ? 'Automotive'
          : currentSymbol === 'AMZN' || currentSymbol === 'WMT'
            ? 'Retail'
            : currentSymbol === 'JPM' || currentSymbol === 'BAC'
              ? 'Financial Services'
              : 'Technology';
      
      // Get companies in the same industry except the current one
      const industryCompanies = demoIndustries[industry] || demoIndustries['Technology'];
      const otherCompanies = industryCompanies
        .filter(company => !company.symbols.includes(currentSymbol))
        .slice(0, 3);
      
      // Create demo data with better sentiment scores
      return otherCompanies.map((company, index) => ({
        symbol: company.symbols[0],
        name: company.name,
        sentiment: currentSentimentValue + (0.3 - index * 0.05),
        industry: industry
      }));
    }
  };

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    setShowSearchResults(false);
    try {
      const [news, quote] = await Promise.all([
        fetchNews(selectedStock, timeRange),
        fetchStockQuote(selectedStock)
      ]);

      const newsWithSentiment = await Promise.all(news.map(async (item) => {
        const sentiment = await analyzeSentiment(item.headline);
        return { ...item, sentiment };
      }));

      setStockQuote(quote);
      setNewsData(newsWithSentiment);
      
      const processedData = await processSentimentData(newsWithSentiment, quote, timeRange);
      setSentimentData(processedData);
      
      // Calculate current sentiment
      const sentiments = newsWithSentiment.map(item => {
        if (!item.sentiment) return 0;
        if (item.sentiment.label === 'POSITIVE') return item.sentiment.score;
        if (item.sentiment.label === 'NEGATIVE') return -item.sentiment.score;
        return 0;
      });
      
      const avgSentiment = sentiments.length > 0 
        ? sentiments.reduce((a, b) => a + b, 0) / sentiments.length 
        : 0;
      
      setCurrentSentiment(avgSentiment);
      
      // Find companies with better sentiment in the same industry
      const betterCompanies = await findCompaniesBetterSentiment(selectedStock, avgSentiment);
      setCompaniesWithBetterSentiment(betterCompanies);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
      
      // Enhanced demo data
      const { from } = getDateRange(timeRange);
      const demoQuote = {
        c: 150 + Math.random() * 50,
        h: 180, l: 140, o: 155, pc: 148,
        t: Date.now() / 1000
      };
      
      const demoNews = Array.from({ length: timeRange * 3 }, (_, i) => {
        const dayOffset = Math.floor(i / 3);
        const timeOffset = (i % 3) * 8 * 3600;
        return {
          datetime: from + dayOffset * 86400 + timeOffset,
          headline: `${selectedStock} ${['rises', 'falls', 'remains stable'][i % 3]} in ${['Asian', 'European', 'US'][i % 3]} markets`,
          source: 'Demo Source',
          url: '#',
          sentiment: {
            label: ['POSITIVE', 'NEGATIVE', 'NEUTRAL'][Math.floor(Math.random() * 3)],
            score: 0.5 + Math.random() * 0.5
          }
        };
      });
      
      setNewsData(demoNews);
      setStockQuote(demoQuote);
      
      const demoProcessedData = await processSentimentData(demoNews, demoQuote, timeRange);
      setSentimentData(demoProcessedData);
      
      // Demo data for better sentiment companies with industry info
      const demoSentiment = 0.2; // Assume this is our current company's sentiment
      setCurrentSentiment(demoSentiment);
      
      // Set demo profile
      setCompanyProfile({
        country: 'US',
        currency: 'USD',
        exchange: 'NASDAQ',
        ipo: '1980-12-12',
        marketCapitalization: 2000000000000,
        name: selectedStock === 'AAPL' ? 'Apple Inc' : selectedStock,
        phone: '1-408-996-1010',
        shareOutstanding: 16000000000,
        ticker: selectedStock,
        weburl: 'https://www.apple.com',
        logo: 'https://static.finnhub.io/logo/87cb30d8-80df-11ea-8951-00000000092a.png',
        finnhubIndustry: selectedStock === 'AAPL' || selectedStock === 'MSFT' ? 'Technology' : 
                          selectedStock === 'TSLA' ? 'Automotive' :
                          selectedStock === 'AMZN' ? 'Retail' : 'Technology'
      });
      
      // Generate demo data for peer companies with better sentiment
      const peerCompanies = await findCompaniesBetterSentiment(selectedStock, demoSentiment);
      setCompaniesWithBetterSentiment(peerCompanies);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedStock, timeRange]);

  const stats = React.useMemo(() => {
    if (!newsData.length) return { avgSentiment: 0, totalPosts: 0, sentimentDist: { positive: 0, negative: 0, neutral: 0 } };
    
    const { from } = getDateRange(timeRange);
    const filteredNews = newsData.filter(item => item.datetime >= from);
    
    const sentiments = filteredNews.map(item => {
      if (!item.sentiment) return 0;
      if (item.sentiment.label === 'POSITIVE') return item.sentiment.score;
      if (item.sentiment.label === 'NEGATIVE') return -item.sentiment.score;
      return 0;
    });
    
    const sentimentDist = filteredNews.reduce((acc, item) => {
      if (!item.sentiment) return acc;
      if (item.sentiment.label === 'POSITIVE') acc.positive++;
      else if (item.sentiment.label === 'NEGATIVE') acc.negative++;
      else acc.neutral++;
      return acc;
    }, { positive: 0, negative: 0, neutral: 0 });
    
    return {
      avgSentiment: sentiments.length > 0 ? sentiments.reduce((a, b) => a + b, 0) / sentiments.length : 0,
      totalPosts: filteredNews.length,
      sentimentDist
    };
  }, [newsData, timeRange]);

  const pieData = [
    { name: 'Positive', value: stats.sentimentDist.positive },
    { name: 'Neutral', value: stats.sentimentDist.neutral },
    { name: 'Negative', value: stats.sentimentDist.negative },
  ];

  const sentimentColor = (label: string) => {
    if (label === 'POSITIVE') return '#10B981';
    if (label === 'NEGATIVE') return '#EF4444';
    return '#F59E0B';
  };

  const sentimentColorValue = (value: number) => {
    if (value > 0.2) return COLORS[0]; // Green
    if (value < -0.2) return COLORS[2]; // Red
    return COLORS[1]; // Yellow
  };

  // Handle input change for search
  const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    if (e.target.value.length >= 2) {
      searchCompanies(e.target.value);
    } else {
      setSearchResults([]);
      setShowSearchResults(false);
    }
  };

  // Handle selecting a company from search results
  const handleSelectCompany = (symbol: string) => {
    setSelectedStock(symbol);
    setSearchTerm('');
    setShowSearchResults(false);
  };

  // Handle selecting a better sentiment company
  const handleSelectBetterCompany = (symbol: string) => {
    setSelectedStock(symbol);
  };

  return (
    <div className="market-sentiment-app">
      <header className="app-header">
        <h1 className="app-title">📊 Market Sentiment Analyzer</h1>
      </header>

      {/* Company Search */}
      <div className="search-container">
        <div className="search-input-wrapper">
          <input
            type="text"
            placeholder="Search for a company..."
            value={searchTerm}
            onChange={handleSearchInputChange}
            className="search-input"
          />
          {showSearchResults && searchResults.length > 0 && (
            <div className="search-results">
              {searchResults.map((company) => (
                <div 
                  key={company.symbol} 
                  className="search-result-item"
                  onClick={() => handleSelectCompany(company.symbol)}
                >
                  <span className="company-symbol">{company.symbol}</span>
                  <span className="company-name">{company.description}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="controls-container">
        <div className="controls">
          {selectedStock && (
            <div className="selected-stock">
              Selected: <strong>{selectedStock}</strong>
              {companyProfile && (
                <span className="company-industry"> ({companyProfile.finnhubIndustry || 'Unknown Industry'})</span>
              )}
            </div>
          )}

          <select
            value={timeRange}
            onChange={(e) => setTimeRange(Number(e.target.value))}
            className="time-select"
          >
            {TIME_RANGES.map(range => (
              <option key={range.value} value={range.value}>{range.label}</option>
            ))}
          </select>

          <button
            onClick={fetchData}
            disabled={loading}
            className="refresh-button"
          >
            {loading ? (
              <>
                <span className="spinner"></span> Loading...
              </>
            ) : (
              'Refresh'
            )}
          </button>
        </div>

        {error && (
          <div className="error-message">
            ⚠️ {error}
          </div>
        )}
      </div>

      {stockQuote && (
        <div className="stock-quote">
          <h2>{companyProfile?.name || selectedStock} Stock Price: ${stockQuote.c.toFixed(2)}</h2>
          <div className="quote-details">
            <span>Open: ${stockQuote.o.toFixed(2)}</span>
            <span>High: ${stockQuote.h.toFixed(2)}</span>
            <span>Low: ${stockQuote.l.toFixed(2)}</span>
            <span>Prev Close: ${stockQuote.pc.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Companies with Better Sentiment Section */}
      {companiesWithBetterSentiment.length > 0 && (
        <div className="better-sentiment-container">
          <h3>Companies in Same Industry with Better Sentiment</h3>
          <div className="better-sentiment-companies">
            {companiesWithBetterSentiment.map((company) => (
              <div 
                key={company.symbol} 
                className="better-sentiment-company"
                onClick={() => handleSelectBetterCompany(company.symbol)}
              >
                <div className="company-name">{company.name} ({company.symbol})</div>
                <div className="company-industry">{company.industry || 'Same industry'}</div>
                <div 
                  className="company-sentiment"
                  style={{ color: sentimentColorValue(company.sentiment) }}
                >
                  Sentiment: {company.sentiment.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="sentiment-overview">
        <div className="sentiment-pie">
          <h3>Sentiment Distribution</h3>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={80}
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
              >
                {pieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => [`${value} articles`, 'Count']} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="sentiment-score">
          <h3>Average Sentiment Score</h3>
          <div
            className="score-display"
            style={{
              color:
                stats.avgSentiment > 0.2 ? COLORS[0] :
                stats.avgSentiment < -0.2 ? COLORS[2] :
                COLORS[1]
            }}
          >
            {stats.avgSentiment.toFixed(2)}
          </div>
          <div className="score-description">
            {stats.avgSentiment > 0.2 ? 'Strong Positive' :
             stats.avgSentiment > 0 ? 'Mildly Positive' :
             stats.avgSentiment < -0.2 ? 'Strong Negative' :
             stats.avgSentiment < 0 ? 'Mildly Negative' : 'Neutral'} Sentiment
          </div>
          <div className="total-articles">
            Analyzed {stats.totalPosts} articles
          </div>
        </div>
      </div>

      {sentimentData.length > 0 && (
        <div className="line-chart-container">
          <h3>Sentiment & Stock Price Over Time</h3>
          <ResponsiveContainer width="100%" height={350}>
            <LineChart
              data={sentimentData}
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="date" stroke="#666" />
              <YAxis yAxisId="left" domain={[-1, 1]} tickFormatter={(v) => v.toFixed(1)} stroke="#10B981" />
              <YAxis yAxisId="right" orientation="right" domain={['dataMin - 5', 'dataMax + 5']} stroke="#3B82F6" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#fff',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                }}
                formatter={(value, name) => {
                  if (name === 'Avg Sentiment') return [value.toFixed(2), name];
                  if (name === 'Stock Price ($)') return [`$${value}`, name];
                  return [value, name];
                }}
              />
              <Legend />
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="avgSentiment"
                stroke="#10B981"
                strokeWidth={2}
                activeDot={{ r: 8 }}
                name="Avg Sentiment"
                dot={{ r: 3 }}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="stockPrice"
                stroke="#3B82F6"
                strokeWidth={2}
                name="Stock Price ($)"
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="news-container">
        <h3>Latest News Headlines</h3>
        <div className="news-list">
          {newsData.map((news, idx) => (
            <div key={idx} className="news-item">
              <a
                href={news.url}
                target="_blank"
                rel="noopener noreferrer"
                className="news-headline"
                title={news.headline}
              >
                {news.headline.length > 100 ? news.headline.slice(0, 100) + '…' : news.headline}
              </a>
              {news.sentiment && (
                <span
                  className="sentiment-badge"
                  style={{
                    backgroundColor: sentimentColor(news.sentiment.label)
                  }}
                >
                  {news.sentiment.label}
                  <span className="sentiment-score-badge">
                    {news.sentiment.score.toFixed(2)}
                  </span>
                </span>
              )}
            </div>
          ))}
          {newsData.length === 0 && (
            <div className="no-news">
              No news data available
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .market-sentiment-app {
          max-width: 1200px;
          margin: 0 auto;
          padding: 24px;
          font-family: 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
          color: #333;
        }

        .app-header {
          text-align: center;
          margin-bottom: 32px;
        }

        .app-title {
          font-size: 2.2rem;
          color: #2d3748;
          margin-bottom: 8px;
        }

        /* Search box styles */
        .search-container {
          display: flex;
          margin-bottom: 24px;
          justify-content: center;
          flex-wrap: wrap;
        }

        .search-input-wrapper {
          position: relative;
          width: 100%;
          max-width: 600px;
        }

        .search-input {
          padding: 12px 16px;
          font-size: 16px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          width: 100%;
          box-shadow: 0 2px 4px rgba(0,0,0,0.05);
        }

        .search-results {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          background-color: white;
          border: 1px solid #e2e8f0;
          border-top: none;
          border-radius: 0 0 6px 6px;
          max-height: 300px;
          overflow-y: auto;
          z-index: 10;
          box-shadow: 0 4px 8px rgba(0,0,0,0.1);
        }

        .search-result-item {
          padding: 12px 16px;
          cursor: pointer;
          display: flex;
          justify-content: space-between;
          border-bottom: 1px solid #f0f0f0;
          transition: background-color 0.2s;
        }

        .search-result-item:hover {
          background-color: #f8fafc;
        }

        .company-symbol {
          font-weight: bold;
          color: #3b82f6;
        }

        .company-name {
          color: #4b5563;
        }

        .company-industry {
          color: #6b7280;
          font-style: italic;
          font-size: 0.9em;
        }

        /* Better sentiment companies section */
        .better-sentiment-container {
          background-color: #f0f9ff;
          padding: 20px;
          border-radius: 8px;
          margin-bottom: 32px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }

        .better-sentiment-container h3 {
          text-align: center;
          margin-bottom: 16px;
          color: #0369a1;
        }

        .better-sentiment-companies {
          display: flex;
          flex-wrap: wrap;
          gap: 16px;
          justify-content: center;
        }

        .better-sentiment-company {
          background-color: white;
          padding: 16px;
          border-radius: 6px;
          min-width: 200px;
          flex: 1;
          max-width: 250px;
          text-align: center;
          cursor: pointer;
          box-shadow: 0 1px 2px rgba(0,0,0,0.1);
          transition: transform 0.2s, box-shadow 0.2s;
        }

        .better-sentiment-company:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 8px rgba(0,0,0,0.1);
        }

        .better-sentiment-company .company-name {
          font-weight: 600;
          margin-bottom: 8px;
          color: #1e293b;
        }

        .better-sentiment-company .company-industry {
          margin-bottom: 8px;
          font-size: 0.9rem;
        }

        .better-sentiment-company .company-sentiment {
          font-size: 1.1rem;
          font-weight: bold;
        }

        /* Selected stock display */
        .selected-stock {
          padding: 10px 16px;
          background-color: #f8fafc;
          border-radius: 6px;
          border: 1px solid #e2e8f0;
          color: #1e293b;
        }

        /* Rest of your styles ... */
        .controls-container {
          margin-bottom: 24px;
        }

        .controls {
          display: flex;
          justify-content: center;
          gap: 12px;
          flex-wrap: wrap;
          margin-bottom: 16px;
        }

        .time-select {
          padding: 10px 16px;
          font-size: 16px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          background-color: white;
          color: #374151;
          min-width: 180px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .time-select:hover {
          border-color: #9ca3af;
        }

        .time-select:focus {
          outline: none;
          border-color: #3b82f6;
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
        }

        .refresh-button {
          padding: 10px 20px;
          font-size: 16px;
          font-weight: 500;
          background-color: #3b82f6;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .refresh-button:hover {
          background-color: #2563eb;
        }

        .refresh-button:disabled {
          background-color: #9ca3af;
          cursor: not-allowed;
        }

        .spinner {
          display: inline-block;
          width: 16px;
          height: 16px;
          border: 2px solid rgba(255,255,255,0.3);
          border-radius: 50%;
          border-top-color: white;
          animation: spin 1s ease-in-out infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .error-message {
          color: #dc2626;
          background-color: #fee2e2;
          padding: 12px;
          border-radius: 6px;
          text-align: center;
          max-width: 600px;
          margin: 0 auto;
        }

        .stock-quote {
          text-align: center;
          margin-bottom: 32px;
          background-color: #f8fafc;
          padding: 20px;
          border-radius: 8px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }

        .stock-quote h2 {
          font-size: 1.8rem;
          color: #1e293b;
          margin-bottom: 12px;
        }

        .quote-details {
          display: flex;
          justify-content: center;
          gap: 24px;
          flex-wrap: wrap;
        }

        .quote-details span {
          font-size: 1rem;
          color: #64748b;
        }

        .sentiment-overview {
          display: flex;
          justify-content: space-between;
          gap: 24px;
          margin-bottom: 32px;
          flex-wrap: wrap;
        }

        .sentiment-pie {
          flex: 1;
          min-width: 300px;
          background-color: white;
          padding: 20px;
          border-radius: 8px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }

        .sentiment-pie h3 {
          text-align: center;
          margin-bottom: 16px;
          color: #1e293b;
        }

        .sentiment-score {
          flex: 1;
          min-width: 300px;
          background-color: white;
          padding: 20px;
          border-radius: 8px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }

        .sentiment-score h3 {
          margin-bottom: 16px;
          color: #1e293b;
        }

        .score-display {
          font-size: 3.5rem;
          font-weight: bold;
          margin-bottom: 8px;
        }

        .score-description {
          font-size: 1.2rem;
          color: #64748b;
          margin-bottom: 12px;
        }

        .total-articles {
          font-size: 0.9rem;
          color: #94a3b8;
        }

        .line-chart-container {
          background-color: white;
          padding: 20px;
          border-radius: 8px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
          margin-bottom: 32px;
        }

        .line-chart-container h3 {
          text-align: center;
          margin-bottom: 16px;
          color: #1e293b;
        }

        .news-container {
          background-color: white;
          padding: 20px;
          border-radius: 8px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }

        .news-container h3 {
          margin-bottom: 16px;
          color: #1e293b;
        }

        .news-list {
          max-height: 400px;
          overflow-y: auto;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
        }

        .news-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px;
          border-bottom: 1px solid #e2e8f0;
          transition: background-color 0.2s;
        }

        .news-item:hover {
          background-color: #f8fafc;
        }

        .news-headline {
          flex: 1;
          margin-right: 16px;
          color: #3b82f6;
          text-decoration: none;
          font-weight: 500;
          transition: color 0.2s;
        }

        .news-headline:hover {
          color: #2563eb;
          text-decoration: underline;
        }

        .sentiment-badge {
          padding: 6px 12px;
          border-radius: 16px;
          color: white;
          font-weight: 600;
          font-size: 0.8rem;
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 80px;
          justify-content: center;
        }

        .sentiment-score-badge {
          background-color: rgba(255,255,255,0.2);
          padding: 2px 6px;
          border-radius: 10px;
          font-size: 0.7rem;
        }

        .no-news {
          padding: 20px;
          text-align: center;
          color: #94a3b8;
        }

        @media (max-width: 768px) {
          .sentiment-overview {
            flex-direction: column;
          }
          
          .controls {
            flex-direction: column;
            align-items: center;
          }
          
          .time-select, .refresh-button {
            width: 100%;
            max-width: 300px;
          }
          
          .better-sentiment-company {
            max-width: 100%;
          }
        }
      `}</style>
    </div>
  );
};

export default MarketSentimentAnalyzer;