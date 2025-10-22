import axios from "axios";

const userId = "yhwon12";
const url = `https://solved.ac/api/v3/search/problem?query=solved_by:${userId}&sort=id&direction=asc&page=1`;

axios.get(url)
  .then(res => {
    console.log(res.data);
  })
  .catch(err => console.error(err));
