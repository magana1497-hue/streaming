const inactivityTimeout = 180000; // 30 seconds 180000
	const valorMaximo = 60;//60
	var valorConteo = 0;
	var startConteo = 0

	let timeoutID;
	let startTime;

	// Function to reset the inactivity timer
	function resetTimer() {
		if(startConteo == 0){
		    clearTimeout(timeoutID);
		    startTime = new Date();
		    timeoutID = setTimeout(redirect, inactivityTimeout);
		}
	    //swal.close();
	}

	// Function to redirect the user
	function redirect() {
	    window.location.href = "/streaming"; // Replace with your desired redirect URL
	}

	// Function to update the displayed inactivity time
		// Function to update the displayed inactivity time
	function updateInactivityTime() {
		
	    const currentTime = new Date();
	    const elapsedTime = currentTime - startTime;
	    const seconds = Math.floor(elapsedTime / 1000);	    
	    /*if( seconds >= 15)
	    	document.getElementById("inactivity-time").textContent = `Inactive for ${valorMaximo-seconds} seconds`;*/	    
	    	var espera = '<div class="card">'+              	      	  
    	  '<p id="inactivity-time"></p>' +
    	  '<p id="inactivity-time2" style="font-size: 46px;"></p></div>'
	    	if(seconds == 60){ //300
	    		startConteo = 1;
	    	Swal.fire({
				icon: 'info',
				title: 'Inactividad en aplicación',
				//text: 'Ha pasado mucho tiempo inactivo, sino realiza alguna consulta se cerrara su sesion en ',
				html: espera,
				confirmButtonColor: '#3085d6',
				confirmButtonText: "Extender Sesi&oacute;n",
				allowOutsideClick: false
			}).then((result) =>{
				if(result.isConfirmed){
					startConteo = 0;
					valorConteo = 0;
					resetTimer();
				}
			});
	    	document.getElementById("inactivity-time").textContent = 'Su sesión está por expirar. Si desea continuar puede extenderla';
	    	document.getElementById("inactivity-time2").textContent =  (valorMaximo - valorConteo);
	    }
    	  if(seconds > 60)//antes 30
    		  valorConteo = valorConteo + 1
    		  
    	  const element1 = document.getElementById("inactivity-time");
    	  const element2 = document.getElementById("inactivity-time2");
    	  
    	  if(element1)
    	  	document.getElementById("inactivity-time").textContent = 'Su sesión está por expirar. Si desea continuar puede extenderla';
  	      
  	      if(element2)
  	      	document.getElementById("inactivity-time2").textContent =  valorMaximo - valorConteo < 0 ? 0 : (valorMaximo - valorConteo);
	    	
	    	//document.getElementById("inactivity-time2").textContent = `Inactive for ${seconds} seconds`;
	    	
	    	
	    if(valorConteo >= valorMaximo){
			redirect();
		}
	    	
	}

	// Event listeners for user activity
	document.addEventListener("mousemove", resetTimer);
	document.addEventListener("keypress", resetTimer);

	// Initial setup
	resetTimer();

	// Update inactivity time every second
	setInterval(updateInactivityTime, 1000);