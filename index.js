const express = require('express');
const axios = require('axios');
const cors = require('cors');
const Jimp = require('jimp');
const QrCode = require('qrcode-reader');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Function to follow URL redirects and get final URL
async function getFinalUrl(url) {
    try {
        const response = await axios.get(url, {
            maxRedirects: 5,
            validateStatus: function (status) {
                return status >= 200 && status < 400; // Accept all successful responses
            }
        });
        return response.request.res.responseUrl || url;
    } catch (error) {
        console.error('Error following redirect:', error);
        return url; // Return original URL if redirect fails
    }
}

// Function to scan QR code from image URL
async function scanQRCode(imageUrl) {
    try {
        // Fetch and read the image
        const image = await Jimp.read(imageUrl);
        const qr = new QrCode();
        
        // Create a promise to handle the QR code scanning
        const value = await new Promise((resolve, reject) => {
            qr.callback = (err, value) => {
                if (err) reject(err);
                resolve(value);
            };
            qr.decode(image.bitmap);
        });

        if (value?.result) {
            // Follow redirects to get the final URL
            const finalUrl = await getFinalUrl(value.result);
            return finalUrl;
        }

        return null;
    } catch (error) {
        console.error('QR Code scanning error:', error);
        return null;
    }
}

async function fetchInstagramData(username) {
    try {
        // First method
        const response = await axios.get(`https://www.instagram.com/${username}/?__a=1&__d=dis`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Cookie': 'ig_did=; ig_nrcb=1; csrftoken=; mid=;',
                'Connection': 'keep-alive',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Cache-Control': 'max-age=0'
            }
        });

        if (!response.data || !response.data.graphql) {
            throw new Error('Invalid response format from Instagram');
        }

        return response.data.graphql.user.edge_owner_to_timeline_media.edges;
    } catch (error) {
        // Second method if first fails
        const response = await axios.get(`https://i.instagram.com/api/v1/users/web_profile_info/?username=${username}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.5',
                'X-IG-App-ID': '936619743392459',
                'X-Requested-With': 'XMLHttpRequest'
            }
        });

        return response.data.data.user.edge_owner_to_timeline_media.edges;
    }
}

async function formatPost(post) {
    const formattedPost = {
        id: post.node.id,
        shortcode: post.node.shortcode,
        caption: post.node.edge_media_to_caption.edges[0]?.node.text || '',
        image_url: post.node.display_url,
        likes: post.node.edge_media_preview_like?.count || 0,
        comments: post.node.edge_media_to_comment?.count || 0,
        timestamp: post.node.taken_at_timestamp,
        thumbnail_url: post.node.thumbnail_src,
        is_video: post.node.is_video,
        video_url: post.node.video_url || null,
        is_carousel: post.node.__typename === 'GraphSidecar',
        carousel_media: []
    };

    // Process carousel media if exists
    if (post.node.edge_sidecar_to_children?.edges) {
        formattedPost.carousel_media = await Promise.all(
            post.node.edge_sidecar_to_children.edges.map(async (child) => {
                const media = {
                    id: child.node.id,
                    is_video: child.node.is_video,
                    image_url: child.node.display_url,
                    video_url: child.node.video_url || null,
                    thumbnail_url: child.node.thumbnail_src
                };

                // Try to scan QR code from the image and get final URL
                const qrResult = await scanQRCode(child.node.display_url);
                if (qrResult) {
                    media.qr_code_url = qrResult;
                    // media.original_qr_url = qrResult; // Keep the original QR URL for reference
                }

                return media;
            })
        );
    }

    return formattedPost;
}

// Get all posts
app.get('/api/instagram/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const posts = await fetchInstagramData(username);
        
        const formattedPosts = await Promise.all(
            posts.slice(0, 5).map(post => formatPost(post))
        );
        
        res.json({
            success: true,
            data: formattedPosts
        });
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get only Gform posts(script gk jelas hiraukan)
app.get('/api/instagram/:username/gform', async (req, res) => {
    try {
        const { username } = req.params;
        const posts = await fetchInstagramData(username);
        
        const gformPosts = await Promise.all(
            posts
                .filter(post => {
                    const caption = post.node.edge_media_to_caption.edges[0]?.node.text || '';
                    return caption.toLowerCase().includes('gform');
                })
                .map(post => formatPost(post))
        );
        
        res.json({
            success: true,
            data: gformPosts
        });
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
}); 