
(function() {
	window.URL = window.URL || window.webkitURL || window.mozURL || window.msURL;

	navigator.getMedia = ( navigator.getUserMedia ||
		navigator.webkitGetUserMedia ||
		navigator.mozGetUserMedia ||
		navigator.msGetUserMedia);

	// ---

	var video = null, videoWidth, videoHeight, webcamStream = null;
	var canvas;
    var videoControls, videoProgressBar, btnVideoCancel, btnVideoDone;
	var gl;
	var effects = [],
		activeEffect = null;
	var shaderProgram;
	var vertexPositionBuffer, uvBuffer, mvMatrix, pMatrix;
	var texture;
	var animatedGIF = null, gifDelay = 100, gifLength = 0, gifMaxLength = 2000, gifRecordStart, recordGIFTimeout = null;
    var MODE_STATIC = 'static', MODE_VIDEO = 'video';
    var mode;

	if (navigator.getMedia) {

		video = document.createElement( 'video' );
		video.autoplay = true;

		var attempts = 0;

		video.addEventListener('loadeddata', function readyListener( event ) {
			findVideoSize();

			function findVideoSize() {
				
				if(video.videoWidth > 0 && video.videoHeight > 0) {

					video.removeEventListener('loadeddata', readyListener);
					init(video.videoWidth, video.videoHeight);

				} else {
					
					if(attempts < 10) {
						attempts++;
						setTimeout(findVideoSize, 500);
					} else {
						init(640, 480);
					}

				}
			}
		});

		navigator.getMedia({ video: true }, function (stream) {
			if(video.mozSrcObject !== undefined) {
				video.mozSrcObject = stream;
			} else {
				video.src = window.URL.createObjectURL(stream);
			}
			webcamStream = stream;
			video.play();
		}, function (error) {
			reportError(error);
		});

	} else {
		reportError('Native device media streaming (getUserMedia) not supported in this browser.');
	}

	function reportError(message) {

		var error = document.createElement('div');
		error.className = 'modal error';

        if(typeof message === 'string') {
            error.innerHTML = message.replace(/\n/g, '<br />');
        } else {
            var txt = 'Error trying to access the camera.<br /><br />Are you trying to run this locally?';
            if(message.code) {
                txt += '<br /><br />(Error code = ' + message.code + ')';
            }
            error.innerHTML = txt;

        }
		document.body.appendChild(error);

		if(webcamStream !== null) {
			webcamStream.stop();
		}

		if(video !== null) {
			video.pause();
			video.src = null;
		}

	}

	function init(width, height) {

		videoWidth = width;
		videoHeight = height;
		
		video.style.width = width + 'px';
		video.style.height = height + 'px';

		canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		
		
		document.getElementById('canvasContainer').appendChild(canvas);

		
		try {

			gl = initWebGL(canvas);
			initWebGLBuffers();
			initTexture();
			initEffects(gl);
			initUI();
		
			render();

		} catch(e) {
			reportError(e.message);
		}
		
	}

	function initWebGL(canvas) {

		var gl = null;
		var options = { preserveDrawingBuffer: true };

		gl = canvas.getContext("webgl", options) || canvas.getContext("experimental-webgl", options);
		gl.viewportWidth = canvas.width;
		gl.viewportHeight = canvas.height;

		gl.shadersCache = {};

		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.LEQUAL);

		return gl;

	}

	function initWebGLBuffers() {
		vertexPositionBuffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, vertexPositionBuffer);
		var vertices = [
			1.0,  1.0,  0.0,
			-1.0,  1.0,  0.0,
			1.0, -1.0,  0.0,
			-1.0, -1.0,  0.0
		];
		
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
		vertexPositionBuffer.itemSize = 3;
		vertexPositionBuffer.numItems = 4;

		uvBuffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);

		var uvs = [
			1.0, 1.0,
			0.0, 1.0,
			1.0, 0.0,
			0.0, 0.0
		];

		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);
		uvBuffer.itemSize = 2;
		uvBuffer.numItems = 4;

		mvMatrix = mat4.create();
		pMatrix = mat4.create();
	}

	function initTexture() {
		texture = gl.createTexture();
		texture.image = video;
	}

	function getShader(glContext, id) {
		var shaderScript = document.getElementById(id);
		if (!shaderScript) {
			throw new Error('Shader with id = ' + id + ' could not be found');
		}

		var str = "";
		var k = shaderScript.firstChild;
		while (k) {
			if (k.nodeType == 3) {
				str += k.textContent;
			}
			k = k.nextSibling;
		}

		var shader;
		if (shaderScript.type == "x-shader/x-fragment") {
			shader = glContext.createShader(gl.FRAGMENT_SHADER);
		} else if (shaderScript.type == "x-shader/x-vertex") {
			shader = glContext.createShader(gl.VERTEX_SHADER);
		} else {
			throw new Error('Unrecognised shader type, id = ' + id);
		}

		glContext.shaderSource(shader, str);
		glContext.compileShader(shader);

		if (!glContext.getShaderParameter(shader, glContext.COMPILE_STATUS)) {
			throw new Error('Shader <strong>' + id + '</strong> could not be compiled\n' + glContext.getShaderInfoLog(shader));
		}

		return shader;
	}

	function initEffects(gl) {

		var effectDefs = {
			'dithering': { vertex: 'vs', fragment: 'fs' },
			'posterize': { vertex: 'vs', fragment: 'fs_bw' }
		};

		var vertexCommonScript = document.getElementById('vs_common').textContent,
			fragmentCommonScript = document.getElementById('fs_common').textContent;

		for(var k in effectDefs) {
			var def = effectDefs[k];
			
			var vertexScript = document.getElementById( def.vertex ).textContent,
				fragmentScript = document.getElementById( def.fragment ).textContent;

			vertexScript = vertexCommonScript + vertexScript;
			fragmentScript = fragmentCommonScript + fragmentScript;

			var effect = new ImageEffect({
				vertexShader: vertexScript,
				fragmentShader: fragmentScript,
				attributes: {
					uv: {},
					position: {}
				},
				uniforms: {
					projectionMatrix: {},
					modelViewMatrix: {},
					map: {}
				}
			});

			effects.push(effect);
			effect.initialise(gl);

		}

		activeEffect = effects[0];

	}

    function initUI() {

        var controls = Array.prototype.slice.call(document.querySelectorAll('.controls'));
        controls.forEach(show);

        videoControls = document.getElementById('video_controls');
        videoProgressBar = document.querySelector('progress');
        btnVideoCancel = document.getElementById('btn_cancel');
        btnVideoDone = document.getElementById('btn_done');


        btnVideoCancel.addEventListener('click', cancelVideoRecording, false);
        btnVideoDone.addEventListener('click', finishVideoRecording, false);

        // Set up 'gestures' using Hammer touch library (HA HA)
        Hammer(canvas)
            .on('touch', onTouchDown)
            .on('release', onTouchEnd)
            .on('tap', onClick)
            .on('swipeleft', prevEffect)
            .on('swiperight', nextEffect);

        var toggle = document.getElementById('mode_toggle');
        Hammer(toggle)
            .on('swipeleft', function() {
                setMode(MODE_STATIC);
            })
            .on('swiperight', function() {
                setMode(MODE_VIDEO);
            })
            .on('tap', function() {
                if(mode === MODE_STATIC) {
                    setMode(MODE_VIDEO);
                } else {
                    setMode(MODE_STATIC);
                }
            });

        //setMode(MODE_STATIC); // TMP
        setMode(MODE_VIDEO);

    }

    function hide(element, transitionLength) {
        transitionLength = transitionLength || 500;
        element.style.opacity = 0;
        setTimeout(function() {
            element.style.display = 'none';
        }, transitionLength);
    }

    function show(element) {
        element.style.display = 'block';
        setTimeout(function() {
            element.style.opacity = 1;
        }, 1);
    }

	function prevEffect() {
		var index = effects.indexOf(activeEffect);
		var newIndex = --index < 0 ? effects.length - 1 : index;
		activeEffect = effects[newIndex];
	}

	function nextEffect() {
		var index = effects.indexOf(activeEffect);
		var newIndex = ++index % effects.length;
		activeEffect = effects[newIndex];
	}

    function onClick() {
        console.log('click');
        if(mode === MODE_STATIC) {
            takePicture();
        }
    }

    function onTouchDown() {
        if(mode === MODE_VIDEO) {
            startVideoRecording();
        }
    }

    function onTouchEnd() {
        if(mode === MODE_VIDEO) {
            pauseVideoRecording();
        }
    }

    function setMode(newMode) {
        var toggle = document.getElementById('mode_toggle');
        var videoControls = document.getElementById('video_controls');
        
        if(newMode === MODE_STATIC) {
            hide(videoControls);
            toggle.innerHTML = 'static (swipe right or tap here to change)';
        } else {
            //show(videoControls);
            toggle.innerHTML = 'video (swipe left or tap here to change)';
        }
        mode = newMode;
    }


	function pad(v) {
		var s = String(v);

		if(s.length < 2) {
			s = '0' + s;
		}

		return s;
	}

	function getTimestamp() {
		var now = new Date();
		var parts = [
			now.getFullYear(),
			pad(now.getMonth()),
			pad(now.getDate()),
			'_',
			pad(now.getHours()),
			pad(now.getMinutes()),
			pad(now.getSeconds())
				];

		var timestamp = parts.join('');

		return timestamp;
	}

	function takePicture() {
		canvas.toBlob(function(blob) {
			saveAs(blob, getTimestamp() + '.png');
		});
	}

    function startVideoRecording() {
        console.log('startVideoRecording');
       
        // We might already have a half-way recorded video
        if(animatedGIF === null) {
            gifRecordStart = Date.now();
            gifLength = 0;

            show(videoControls);

            animatedGIF = new Animated_GIF({ workerPath: 'js/libs/Animated_GIF/quantizer.js' });
            animatedGIF.setSize(videoWidth, videoHeight);
            animatedGIF.setDelay(gifDelay);
            animatedGIF.setRepeat(1);
        }
        addFrameToGIF();
    }

    function pauseVideoRecording() {
        clearTimeout(recordGIFTimeout);
    }

    function addFrameToGIF() {
        console.log('add frame');
        animatedGIF.addFrame(canvas);
        gifLength += gifDelay;

        if(gifLength < gifMaxLength && !animatedGIF.isRendering()) {
            var recordProgress = gifLength * 1.0 / gifMaxLength;
            videoProgressBar.value = recordProgress;
            console.log('recorded amnt', recordProgress, Math.floor(recordProgress*100) + '%');
            
            recordGIFTimeout = setTimeout(addFrameToGIF, gifDelay);
        } else {
            finishVideoRecording();
        }
    }
    
    function finishVideoRecording() {

        console.log('FINISH VIDEO RECORDING');

        clearTimeout(recordGIFTimeout);

        var videoControls = document.getElementById('video_controls'),
            progressBar = document.querySelector('progress'),
            progressSpan = progressBar.querySelector('span');

        progressBar.classList.add('rendering');
        
        animatedGIF.onRenderProgress(function(progress) {
            progressSpan.innerHTML = 'rendering ' + Math.floor(progress * 100) + '%';
            console.log('render progress', progress);
            progressBar.value = progress;
        });

        animatedGIF.getBase64GIF(function(gifData) {

            var a = document.createElement('a');
            a.setAttribute('href', gifData);
            a.setAttribute('download', getTimestamp() + '.gif');

            // Apparently the download won't start unless the anchor element
            // is in the DOM tree
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            progressBar.classList.remove('rendering');
            progressSpan.innerHTML = '';
            hide(videoControls);

            // we're done with this instance
            animatedGIF = null;

        });
    }

    function cancelVideoRecording() {
        clearTimeout(recordGIFTimeout);
        // TODO animatedGIF.reset();
        hide(videoControls);
        videoProgressBar.value = 0;
        animatedGIF = null;
    }

	function updateTexture(texture, video) {
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.bindTexture(gl.TEXTURE_2D, null);
	}

	function render() {
		requestAnimationFrame( render );

		if( video.readyState === video.HAVE_ENOUGH_DATA ) {
			updateTexture(texture, video);
		}

		gl.viewport(0, 0, gl.viewportWidth, gl.viewportHeight);
		gl.clearColor(1.0, 0.0, 0.0, 1.0);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

		mat4.ortho(pMatrix, -1, 1, -1, 1, 0.1, 1000);
		
        mat4.identity(mvMatrix);
		mat4.translate(mvMatrix, mvMatrix, [0.0, 0.0, -1.0]);

		// For TESTING only 
		// activeEffect = effects[ Math.floor(effects.length * Math.random()) ];
		activeEffect.enable(gl);
		
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, texture);

		gl.uniform1i(activeEffect.uniforms.map.id, 0);

		gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
		gl.vertexAttribPointer(activeEffect.attributes.uv.id, uvBuffer.itemSize, gl.FLOAT, false, 0, 0);

		gl.bindBuffer(gl.ARRAY_BUFFER, vertexPositionBuffer);
		gl.vertexAttribPointer(activeEffect.attributes.position.id, vertexPositionBuffer.itemSize, gl.FLOAT, false, 0, 0);
		
		gl.uniformMatrix4fv(activeEffect.uniforms.projectionMatrix.id, false, pMatrix);
		gl.uniformMatrix4fv(activeEffect.uniforms.modelViewMatrix.id, false, mvMatrix);
        
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, vertexPositionBuffer.numItems);

		activeEffect.disable(gl);
		
	}
	
})();
